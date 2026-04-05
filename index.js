const baseURL = "https://assessment.ksensetech.com/api";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isNumeric = (val) => {
  return /^[0-9]+(\.[0-9]+)?$/.test(String(val).trim());
};

const calcBloodPressureScore = (reading) => {
  // Invalid (0 points)
  // Null, undefined, emptpy
  const entry = { score: 0, dataIssue: false };
  if (
    !reading ||
    typeof reading !== "string" ||
    reading === "" ||
    !reading.includes("/")
  ) {
    entry.dataIssue = true;
    return entry;
  }

  // Missing a value ("xx/", "/xx")
  const vals = reading.split("/");
  if (vals.length !== 2) {
    entry.dataIssue = true;
    return entry;
  }

  const sysRaw = vals[0].trim();
  const diaRaw = vals[1].trim();

  const sysValid = isNumeric(sysRaw);
  const diaValid = isNumeric(diaRaw);

  if (!sysValid || !diaValid) {
    entry.dataIssue = true;
  }

  const sys = sysValid ? Number(sysRaw) : null;
  const dia = diaValid ? Number(diaRaw) : null;

  if (sys === null && dia === null) return entry;

  if (sys < 120 && dia < 80) {
    entry.score = 0;
  } else if (sys >= 120 && sys <= 129 && dia < 80) {
    entry.score = 1;
  } else if ((sys >= 130 && sys <= 139) || (dia >= 80 && dia <= 89)) {
    entry.score = 2;
  } else {
    entry.score = 3;
  }
  return entry;
};

const calcTempScore = (reading) => {
  const entry = { score: 0, dataIssue: false };
  if (!reading || !isNumeric(reading)) {
    entry.dataIssue = true;
    return entry;
  }
  // if (reading <= 99.5) return 0;
  if (reading >= 99.6 && reading <= 100.9) entry.score = 1;
  if (reading >= 101) entry.score = 2;
  return entry;
};

const calcAgeScore = (reading) => {
  const entry = { score: 0, dataIssue: false };
  if (!reading) entry.dataIssue = true;
  if (!isNumeric(reading)) entry.dataIssue = true;

  if (entry.dataIssue) {
    return entry;
  }

  if (reading >= 40 && reading <= 65) entry.score = 1;
  if (reading > 65) entry.score = 2;

  return entry;
};

const getPage = async (page = 15, limit = 5) => {
  const apiKey = process.env.KSENSE_API_KEY;
  const endpointWParams = `/patients?page=${page}&limit=${limit}`;
  console.log("apiKey", apiKey);
  if (!apiKey) {
    throw new Error("No API key available.");
  }

  const response = await fetch(`${baseURL}${endpointWParams}`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });
  console.log("response:", response);

  if (!response.ok) {
    const error = new Error(`Fetch error: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  console.log("data:", data);

  const patients = data.patients || data.data || [];
  const pagination = data.pagination
    ? {
        page: data.pagination.page,
        limit: data.pagination.limit,
        total: data.pagination.total,
        totalPages: data.pagination.totalPages,
        hasNext: data.pagination.hasNext,
      }
    : {
        page: data.current_page,
        limit: data.per_page,
        total: data.total_records,
        totalPages: Math.ceil(data.total_records / data.per_page),
        hasNext: data.current_page * data.per_page < data.total_records,
      };

  return { patients, pagination };
};

const getFullDataSet = async () => {
  let page = 1;
  const limit = 5;
  let allPatients = [];
  let hasNext = true;
  while (hasNext) {
    try {
      // Get patients/pagination info for current page.
      const { patients, pagination } = await getPage(page, limit);

      // add new patients to full list
      allPatients = allPatients.concat(patients);

      // set whether there are more pages
      hasNext = pagination.hasNext;

      // increment page counter
      page += 1;

      if (hasNext) {
        await delay(200);
      }
    } catch (err) {
      console.error(`Error on page ${page}:`, err);

      // If err code is 500 or 503, try retrieving the same page again.
      if (err?.status === 500 || err?.status === 503) {
        console.log("Retrying...");
        continue;
      }
      if (err?.status === 429) {
        console.log("Retrying after delay...");
        await delay(3000); // longer delay for retries
        continue;
      }

      // If this is not an expected error, abort.
      throw err;
    }
  }

  return allPatients;
};

const submit = async (body) => {
  const apiKey = process.env.KSENSE_API_KEY;
  const fullURL = `${baseURL}/submit-assessment`;
  const response = await fetch(fullURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: body,
  });

  const data = await response.json();
  console.log("Assessment Results:");
  console.log(JSON.stringify(data, null, 2));
};

const main = async () => {
  try {
    const data = await getFullDataSet();
    console.log("Total patients:", data.length);
    console.log("full data set:", data);
    const highRiskPatients = [];
    const feverPatients = [];
    const dataQualityPatients = [];

    for (const entry of data) {
      const { patient_id: patientId, age, blood_pressure, temperature } = entry;
      if (!patientId) continue;
      const ageScore = calcAgeScore(age);
      console.log("ageScore:", ageScore);
      const bloodPressureScore = calcBloodPressureScore(blood_pressure);
      console.log("bloodPressureScore:", bloodPressureScore);
      const tempScore = calcTempScore(temperature);
      console.log("tempScore:", tempScore);

      if (tempScore.score >= 1) {
        feverPatients.push(patientId);
      }

      const patientTotalScore =
        bloodPressureScore.score + tempScore.score + ageScore.score;
      if (patientTotalScore >= 4) {
        highRiskPatients.push(patientId);
      }

      if (
        bloodPressureScore.dataIssue ||
        tempScore.dataIssue ||
        ageScore.dataIssue
      ) {
        console.log("data issue!:", entry);
        dataQualityPatients.push(patientId);
      }
    }

    const results = {
      high_risk_patients: highRiskPatients,
      fever_patients: feverPatients,
      data_quality_issues: dataQualityPatients,
    };

    const numHighRisk = highRiskPatients.length;
    const numFever = feverPatients.length;
    const numQualityIssues = dataQualityPatients.length;
    console.log(
      `high risk: ${numHighRisk} - fever: ${numFever} - quality issues: ${numQualityIssues}`,
    );

    const stringifiedBody = JSON.stringify(results);

    console.log("stringifiedBody:", stringifiedBody);

    await submit(stringifiedBody);
  } catch (err) {
    console.error("err:", err);
  }
  return true;
};

// silence jest error for process.env
if (require.main === module) {
  main();
}

module.exports = {
  main,
  getPage,
  getFullDataSet,
  calcBloodPressureScore,
  calcTempScore,
  calcAgeScore,
};
