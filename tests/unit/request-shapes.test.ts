/**
 * Regression lock for the Planka v2.1 route contract (commit 764821a).
 *
 * These assert the EXACT path / method / body each operation sends — the
 * routes that the v2 rewrite changed and that have no automated proof
 * otherwise. If a future edit drifts a route back toward the old v1 shape,
 * one of these fails loudly.
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
  createComment,
  deleteComment,
  getComments,
  updateComment,
} from "../../operations/comments.js";
import { addLabelToCard, removeLabelFromCard } from "../../operations/labels.js";
import {
  createBoardMembership,
  deleteBoardMembership,
  getBoardMembership,
  getBoardMemberships,
  updateBoardMembership,
} from "../../operations/boardMemberships.js";
import { createTask } from "../../operations/tasks.js";
import { createList } from "../../operations/lists.js";
import { createCard } from "../../operations/cards.js";

import {
  businessCalls,
  jsonBody,
  methodOf,
  mockFetch,
  onlyBusinessCall,
} from "./helpers.js";

afterEach(() => {
  jest.restoreAllMocks();
});

/** Pathname of a recorded request, for exact-route assertions independent of host. */
function path(url: string): string {
  return new URL(url).pathname;
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: "bm1",
    boardId: "b1",
    userId: "u1",
    role: "editor",
    canComment: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: null,
    ...overrides,
  };
}

describe("comments (Planka v2: first-class /comments, not commentCard actions)", () => {
  it("createComment → POST /api/cards/:id/comments {text}", async () => {
    const spy = mockFetch((url, init) => {
      if (path(url) === "/api/cards/c1/comments" && methodOf(init) === "POST") {
        return { body: { item: { id: "cm1", text: "hello" } } };
      }
      return undefined;
    });

    const result = await createComment({ cardId: "c1", text: "hello" });

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/cards/c1/comments");
    expect(methodOf(call.init)).toBe("POST");
    expect(jsonBody(call.init)).toEqual({ text: "hello" });
    expect(result).toMatchObject({ id: "cm1", text: "hello" });
  });

  it("getComments → GET /api/cards/:id/comments", async () => {
    const spy = mockFetch((url) => {
      if (path(url) === "/api/cards/c1/comments") {
        return { body: { items: [{ id: "cm1", text: "hi" }] } };
      }
      return undefined;
    });

    const result = await getComments("c1");

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/cards/c1/comments");
    expect(methodOf(call.init)).toBe("GET");
    expect(result).toEqual([{ id: "cm1", text: "hi" }]);
  });

  it("updateComment → PATCH /api/comments/:id {text}", async () => {
    const spy = mockFetch((url, init) => {
      if (path(url) === "/api/comments/cm1" && methodOf(init) === "PATCH") {
        return { body: { item: { id: "cm1", text: "edited" } } };
      }
      return undefined;
    });

    await updateComment("cm1", { text: "edited" });

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/comments/cm1");
    expect(methodOf(call.init)).toBe("PATCH");
    expect(jsonBody(call.init)).toEqual({ text: "edited" });
  });

  it("deleteComment → DELETE /api/comments/:id", async () => {
    const spy = mockFetch();

    const result = await deleteComment("cm1");

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/comments/cm1");
    expect(methodOf(call.init)).toBe("DELETE");
    expect(result).toEqual({ success: true });
  });
});

describe("card labels (Planka v2: card-labels with literal labelId: prefix)", () => {
  it("addLabelToCard → POST /api/cards/:id/card-labels {labelId}", async () => {
    const spy = mockFetch();

    await addLabelToCard("c1", "l1");

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/cards/c1/card-labels");
    expect(methodOf(call.init)).toBe("POST");
    expect(jsonBody(call.init)).toEqual({ labelId: "l1" });
  });

  it("removeLabelFromCard → DELETE /api/cards/:id/card-labels/labelId:<id>", async () => {
    const spy = mockFetch();

    await removeLabelFromCard("c1", "l1");

    const call = onlyBusinessCall(spy);
    // The literal `labelId:` prefix is Planka's path-param format — the crux of the v2 fix.
    expect(path(call.url)).toBe("/api/cards/c1/card-labels/labelId:l1");
    expect(methodOf(call.init)).toBe("DELETE");
  });
});

describe("board memberships (Planka v2: nested create, board-detail list, flat by-id)", () => {
  it("createBoardMembership → POST /api/boards/:id/board-memberships {userId, role}", async () => {
    const spy = mockFetch((url, init) => {
      if (
        path(url) === "/api/boards/b1/board-memberships" &&
        methodOf(init) === "POST"
      ) {
        return { body: { item: membership() } };
      }
      return undefined;
    });

    await createBoardMembership({ boardId: "b1", userId: "u1", role: "editor" });

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/boards/b1/board-memberships");
    expect(methodOf(call.init)).toBe("POST");
    expect(jsonBody(call.init)).toEqual({ userId: "u1", role: "editor" });
  });

  it("getBoardMemberships → GET /api/boards/:id then reads included.boardMemberships", async () => {
    const item = membership();
    const spy = mockFetch((url) => {
      if (path(url) === "/api/boards/b1") {
        return { body: { item: { id: "b1" }, included: { boardMemberships: [item] } } };
      }
      return undefined;
    });

    const result = await getBoardMemberships("b1");

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/boards/b1");
    expect(methodOf(call.init)).toBe("GET");
    expect(result).toEqual([item]);
  });

  it("getBoardMembership → GET /api/board-memberships/:id", async () => {
    const spy = mockFetch((url) => {
      if (path(url) === "/api/board-memberships/bm1") {
        return { body: { item: membership() } };
      }
      return undefined;
    });

    await getBoardMembership("bm1");

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/board-memberships/bm1");
    expect(methodOf(call.init)).toBe("GET");
  });

  it("updateBoardMembership → PATCH /api/board-memberships/:id", async () => {
    const spy = mockFetch((url, init) => {
      if (
        path(url) === "/api/board-memberships/bm1" &&
        methodOf(init) === "PATCH"
      ) {
        return { body: { item: membership({ role: "viewer" }) } };
      }
      return undefined;
    });

    await updateBoardMembership("bm1", { role: "viewer" });

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/board-memberships/bm1");
    expect(methodOf(call.init)).toBe("PATCH");
    expect(jsonBody(call.init)).toEqual({ role: "viewer" });
  });

  it("deleteBoardMembership → DELETE /api/board-memberships/:id", async () => {
    const spy = mockFetch();

    await deleteBoardMembership("bm1");

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/board-memberships/bm1");
    expect(methodOf(call.init)).toBe("DELETE");
  });
});

describe("tasks (Planka v2: tasks nested under task-lists via ensureTaskListId)", () => {
  it("createTask reuses an existing task list, then POSTs the task", async () => {
    const spy = mockFetch((url, init) => {
      const p = path(url);
      if (p === "/api/cards/c1" && methodOf(init) === "GET") {
        return { body: { item: { id: "c1" }, included: { taskLists: [{ id: "tl1" }] } } };
      }
      if (p === "/api/task-lists/tl1/tasks" && methodOf(init) === "POST") {
        return { body: { item: { id: "t1", name: "Task A" } } };
      }
      return undefined;
    });

    await createTask({ cardId: "c1", name: "Task A" });

    const calls = businessCalls(spy);
    expect(calls.map((c) => `${methodOf(c.init)} ${path(c.url)}`)).toEqual([
      "GET /api/cards/c1",
      "POST /api/task-lists/tl1/tasks",
    ]);
    expect(jsonBody(calls[1].init)).toEqual({ name: "Task A", position: 65535 });
  });

  it("createTask creates a task list when the card has none, then POSTs the task", async () => {
    const spy = mockFetch((url, init) => {
      const p = path(url);
      if (p === "/api/cards/c1" && methodOf(init) === "GET") {
        return { body: { item: { id: "c1" }, included: { taskLists: [] } } };
      }
      if (p === "/api/cards/c1/task-lists" && methodOf(init) === "POST") {
        return { body: { item: { id: "tl2" } } };
      }
      if (p === "/api/task-lists/tl2/tasks" && methodOf(init) === "POST") {
        return { body: { item: { id: "t2" } } };
      }
      return undefined;
    });

    await createTask({ cardId: "c1", name: "Task B", position: 100 });

    const calls = businessCalls(spy);
    expect(calls.map((c) => `${methodOf(c.init)} ${path(c.url)}`)).toEqual([
      "GET /api/cards/c1",
      "POST /api/cards/c1/task-lists",
      "POST /api/task-lists/tl2/tasks",
    ]);
    expect(jsonBody(calls[1].init)).toEqual({ name: "Tasks", position: 65535 });
    expect(jsonBody(calls[2].init)).toEqual({ name: "Task B", position: 100 });
  });
});

describe("create-chain (Planka v2.1: required `type` on list/card create)", () => {
  it("createList → POST /api/boards/:id/lists defaults type to 'active'", async () => {
    const spy = mockFetch((url, init) => {
      if (path(url) === "/api/boards/b1/lists" && methodOf(init) === "POST") {
        return {
          body: {
            item: {
              id: "l1",
              boardId: "b1",
              name: "Todo",
              position: 1,
              createdAt: "2020-01-01T00:00:00.000Z",
              updatedAt: null,
            },
          },
        };
      }
      return undefined;
    });

    await createList({ boardId: "b1", name: "Todo", position: 1 });

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/boards/b1/lists");
    expect(methodOf(call.init)).toBe("POST");
    expect(jsonBody(call.init)).toMatchObject({
      name: "Todo",
      position: 1,
      type: "active",
    });
  });

  it("createList honors an explicit list type", async () => {
    const spy = mockFetch((url) => {
      if (path(url) === "/api/boards/b1/lists") {
        return {
          body: {
            item: {
              id: "l1",
              boardId: "b1",
              name: "Done",
              position: 2,
              createdAt: "2020-01-01T00:00:00.000Z",
              updatedAt: null,
            },
          },
        };
      }
      return undefined;
    });

    await createList({ boardId: "b1", name: "Done", position: 2, type: "closed" });

    expect(jsonBody(onlyBusinessCall(spy).init)).toMatchObject({ type: "closed" });
  });

  it("createCard → POST /api/lists/:id/cards defaults type to 'project'", async () => {
    const spy = mockFetch((url, init) => {
      if (path(url) === "/api/lists/l1/cards" && methodOf(init) === "POST") {
        return {
          body: {
            item: {
              id: "c1",
              listId: "l1",
              name: "Card",
              description: null,
              position: 1,
              dueDate: null,
              createdAt: "2020-01-01T00:00:00.000Z",
              updatedAt: null,
            },
          },
        };
      }
      return undefined;
    });

    await createCard({ listId: "l1", name: "Card", position: 1 });

    const call = onlyBusinessCall(spy);
    expect(path(call.url)).toBe("/api/lists/l1/cards");
    expect(methodOf(call.init)).toBe("POST");
    expect(jsonBody(call.init)).toMatchObject({
      name: "Card",
      position: 1,
      type: "project",
    });
  });

  it("createCard honors an explicit card type", async () => {
    const spy = mockFetch((url) => {
      if (path(url) === "/api/lists/l1/cards") {
        return {
          body: {
            item: {
              id: "c1",
              listId: "l1",
              name: "Story",
              description: null,
              position: 1,
              dueDate: null,
              createdAt: "2020-01-01T00:00:00.000Z",
              updatedAt: null,
            },
          },
        };
      }
      return undefined;
    });

    await createCard({ listId: "l1", name: "Story", position: 1, type: "story" });

    expect(jsonBody(onlyBusinessCall(spy).init)).toMatchObject({ type: "story" });
  });
});
