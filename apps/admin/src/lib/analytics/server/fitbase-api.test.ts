import { describe, expect, spyOn, test } from "bun:test";

import { fbFetch, fbRequest, type FbSession } from "./fitbase-api.server";

const session = (): FbSession => ({
  id: 1,
  domain: "test-club",
  key: "Bearer test-token",
  progressive: true,
  deadline: performance.now() + 10_000,
  paginationWarnings: [],
  progress: async () => {},
});
const reply = (ids: number[], total: number) =>
  Response.json({ items: ids.map((id) => ({ id })), total_count: total, page_size: 100 });

describe("FitBase API: полнота постраничной выгрузки", () => {
  test("100 строк на странице, тот же клуб и даты, все ID без дублей", async () => {
    const requests: URL[] = [];
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      const url = new URL(String(input));
      requests.push(url);
      expect(options?.headers).toMatchObject({
        Authorization: "Bearer test-token",
        club: "test-club",
        domain: "test-club",
      });
      return url.searchParams.get("page") === "1"
        ? reply(
            Array.from({ length: 100 }, (_, i) => i + 1),
            137,
          )
        : reply(
            Array.from({ length: 37 }, (_, i) => i + 101),
            137,
          );
    });
    try {
      const s = session();
      const result = await fbFetch(s, "schedule-registration", {
        "clubs_id[]": 7,
        date_from: "2026-10-01",
        date_to: "2026-10-31",
      });
      expect(result.map((r) => r.id)).toEqual(Array.from({ length: 137 }, (_, i) => i + 1));
      expect(requests).toHaveLength(2);
      for (const url of requests) {
        expect(url.searchParams.get("page_size")).toBe("100");
        expect(url.searchParams.get("clubs_id[]")).toBe("7");
        expect(url.searchParams.get("date_from")).toBe("2026-10-01");
        expect(url.searchParams.get("date_to")).toBe("2026-10-31");
      }
      expect(s.lastFetch).toMatchObject({ total: 137, received: 137 });
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("ответ сервера с меньшей страницей не обрывает загрузку до total_count", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const page = Number(new URL(String(input)).searchParams.get("page"));
      return reply([page * 2 - 1, page * 2], 6);
    });
    try {
      expect(await fbFetch(session(), "schedule-registration")).toHaveLength(6);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("пустая страница до total_count и повтор страницы не принимаются за успех", async () => {
    for (const empty of [true, false]) {
      let count = 0;
      const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async () => {
        count++;
        return reply(count === 1 || !empty ? [1, 2] : [], 5);
      });
      try {
        await expect(fbFetch(session(), "schedule-registration")).rejects.toThrow(
          empty ? "пустая страница до конца" : "повтор страницы",
        );
      } finally {
        fetchMock.mockRestore();
      }
    }
  });

  test("после 502 повторяется та же страница, без потери данных и утечки тела ошибки", async () => {
    let attempts = 0;
    const urls: string[] = [];
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return ++attempts === 1
        ? Response.json({ message: "private upstream details test-token" }, { status: 502 })
        : reply([1, 2], 2);
    });
    try {
      expect(await fbFetch(session(), "schedule-registration")).toHaveLength(2);
      expect(urls).toHaveLength(2);
      expect(urls[0]).toBe(urls[1]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("401 не повторяется как временный сбой и не раскрывает токен", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ message: "test-token" }, { status: 401 }),
    );
    try {
      await expect(fbFetch(session(), "lead")).rejects.toThrow("нет доступа");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  test("явный размер страницы сохраняется; 502 описывает сбой сервиса", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(new URL(String(input)).searchParams.get("page_size")).toBe("40");
      return Response.json({ message: "secret test-token" }, { status: 502 });
    });
    try {
      await expect(fbRequest(session(), "lead", 1, { page_size: 40 })).rejects.toThrow(
        "HTTP 502. Сервис временно недоступен",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});
