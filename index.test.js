const {
  main,
  getPage,
  getFullDataSet,
  calcBloodPressureScore,
  calcTempScore,
  calcAgeScore,
} = require("./index");

global.fetch = jest.fn();

describe("getPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KSENSE_API_KEY = "test-key";
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("handles minimal pagination responses", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        patients: [{ id: 1 }],
        current_page: 1,
        per_page: 5,
        total_records: 10,
      }),
    });
    const result = await getPage(1, 5);

    expect(result.patients).toEqual([{ id: 1 }]);
    expect(result.pagination.hasNext).toBe(true);
  });

  it("handles verbose pagination response", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 2 }],
        pagination: {
          page: 1,
          limit: 5,
          total: 5,
          totalPages: 1,
          hasNext: false,
        },
      }),
    });

    const result = await getPage(1, 5);

    expect(result.patients).toEqual([{ id: 2 }]);
    expect(result.pagination.hasNext).toBe(false);
  });

  it("throws on non-OK response", async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(getPage(1, 5)).rejects.toThrow();
  });

  it("throws if API key missing", async () => {
    delete process.env.KSENSE_API_KEY;

    await expect(getPage(1, 5)).rejects.toThrow("No API key available.");
  });
});
describe("getFullDataSet", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KSENSE_API_KEY = "test-key";
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fetches multiple pages and aggregates results", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 1 }],
          pagination: {
            hasNext: true,
            page: 1,
            limit: 5,
            total: 2,
            totalPages: 2,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 2 }],
          pagination: {
            hasNext: false,
            page: 2,
            limit: 5,
            total: 2,
            totalPages: 2,
          },
        }),
      });

    const result = await getFullDataSet();

    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 error", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 1 }],
          pagination: { hasNext: false },
        }),
      });

    const result = await getFullDataSet();

    expect(result).toEqual([{ id: 1 }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("scoring functions", () => {
  it("calculates normal blood pressure correctly", () => {
    expect(calcBloodPressureScore("110/70").score).toBe(0);
  });

  it("detects invalid blood pressure", () => {
    const result = calcBloodPressureScore("INVALID");
    expect(result.dataIssue).toBe(true);
  });

  it("calculates temperature ranges correctly", () => {
    expect(calcTempScore(98.6).score).toBe(0);
    expect(calcTempScore(100).score).toBe(1);
    expect(calcTempScore(101).score).toBe(2);
  });

  it("flags invalid temperature", () => {
    expect(calcTempScore("bad").dataIssue).toBe(true);
  });

  it("calculates age scoring correctly", () => {
    expect(calcAgeScore(30).score).toBe(0);
    expect(calcAgeScore(50).score).toBe(1);
    expect(calcAgeScore(70).score).toBe(2);
  });
});
