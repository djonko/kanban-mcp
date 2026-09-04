/**
 * @fileoverview Comment operations for the MCP Kanban server
 *
 * This module provides functions for interacting with comments in the Planka Kanban board,
 * including creating, retrieving, updating, and deleting comments on cards.
 *
 * Planka v2 note: comments are first-class resources under
 * `/api/cards/:cardId/comments` (and `/api/comments/:id`). Earlier Planka modeled
 * them as `commentCard` actions under `/api/cards/:cardId/comment-actions` — this
 * module was updated for the v2 routes (homelab Planka 2.1.1).
 */

import { z } from "zod";
import { plankaRequest } from "../common/utils.js";

// Schema definitions
/**
 * Schema for creating a new comment
 * @property {string} cardId - The ID of the card to create the comment on
 * @property {string} text - The text content of the comment
 */
export const CreateCommentSchema = z.object({
    cardId: z.string().describe("Card ID"),
    text: z.string().describe("Comment text"),
});

/**
 * Schema for retrieving comments from a card
 * @property {string} cardId - The ID of the card to get comments from
 */
export const GetCommentsSchema = z.object({
    cardId: z.string().describe("Card ID"),
});

/**
 * Schema for retrieving a specific comment
 * @property {string} id - The ID of the comment to retrieve
 */
export const GetCommentSchema = z.object({
    id: z.string().describe("Comment ID"),
});

/**
 * Schema for updating a comment
 * @property {string} id - The ID of the comment to update
 * @property {string} text - The new text content for the comment
 */
export const UpdateCommentSchema = z.object({
    id: z.string().describe("Comment ID"),
    text: z.string().describe("Comment text"),
});

/**
 * Schema for deleting a comment
 * @property {string} id - The ID of the comment to delete
 */
export const DeleteCommentSchema = z.object({
    id: z.string().describe("Comment ID"),
});

// Type exports
/**
 * Type definition for comment creation options
 */
export type CreateCommentOptions = z.infer<typeof CreateCommentSchema>;

/**
 * Type definition for comment update options
 */
export type UpdateCommentOptions = z.infer<typeof UpdateCommentSchema>;

// Comment schema (Planka v2: first-class comment, `text` at the top level —
// not the old `commentCard` action with `data.text`). Permissive on extra
// fields so minor shape changes across point releases don't break parsing.
const CommentSchema = z.object({
    id: z.string(),
    text: z.string(),
    cardId: z.string().optional(),
    userId: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().nullable().optional(),
}).passthrough();

// Response schemas
const CommentsResponseSchema = z.object({
    items: z.array(CommentSchema),
    included: z.record(z.any()).optional(),
});

const CommentResponseSchema = z.object({
    item: CommentSchema,
    included: z.record(z.any()).optional(),
});

// Function implementations
/**
 * Creates a new comment on a card
 *
 * @param {CreateCommentOptions} options - Options for creating the comment
 * @returns {Promise<object>} The created comment
 * @throws {Error} If the comment creation fails
 */
export async function createComment(options: CreateCommentOptions) {
    try {
        const response = await plankaRequest(
            `/api/cards/${options.cardId}/comments`,
            {
                method: "POST",
                body: {
                    text: options.text,
                },
            },
        );
        const parsedResponse = CommentResponseSchema.parse(response);
        return parsedResponse.item;
    } catch (error) {
        throw new Error(
            `Failed to create comment: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

/**
 * Retrieves all comments for a specific card
 *
 * @param {string} cardId - The ID of the card to get comments for
 * @returns {Promise<Array<object>>} Array of comments on the card
 */
export async function getComments(cardId: string) {
    // Let request errors propagate; only a genuinely empty card yields [].
    const response = await plankaRequest(`/api/cards/${cardId}/comments`);

    try {
        const parsedResponse = CommentsResponseSchema.parse(response);
        return parsedResponse.items;
    } catch (parseError) {
        if (Array.isArray(response)) {
            return z.array(CommentSchema).parse(response);
        }
        throw new Error(
            `Could not parse comments response: ${JSON.stringify(response)}`,
        );
    }
}

/**
 * Retrieves a specific comment by ID
 *
 * Planka has no GET-by-id route for a single comment, so this walks the boards
 * and cards and matches the comment id within each card's comment list.
 *
 * @param {string} id - The ID of the comment to retrieve
 * @returns {Promise<object>} The requested comment
 * @throws {Error} If retrieving the comment fails
 */
export async function getComment(id: string) {
    try {
        const projectsResponse = await plankaRequest(`/api/projects`);

        if (
            !projectsResponse ||
            typeof projectsResponse !== "object" ||
            !("included" in projectsResponse) ||
            !projectsResponse.included ||
            typeof projectsResponse.included !== "object"
        ) {
            throw new Error("Failed to get projects");
        }

        const included = projectsResponse.included as Record<string, unknown>;

        if (!("boards" in included) || !Array.isArray(included.boards)) {
            throw new Error("No boards found");
        }

        for (const board of included.boards) {
            if (
                typeof board !== "object" || board === null || !("id" in board)
            ) {
                continue;
            }

            const boardId = board.id as string;
            const boardResponse = await plankaRequest(`/api/boards/${boardId}`);

            if (
                !boardResponse ||
                typeof boardResponse !== "object" ||
                !("included" in boardResponse) ||
                !boardResponse.included ||
                typeof boardResponse.included !== "object"
            ) {
                continue;
            }

            const boardIncluded = boardResponse.included as Record<
                string,
                unknown
            >;

            if (
                !("cards" in boardIncluded) ||
                !Array.isArray(boardIncluded.cards)
            ) {
                continue;
            }

            for (const card of boardIncluded.cards) {
                if (
                    typeof card !== "object" || card === null || !("id" in card)
                ) {
                    continue;
                }

                const cardId = card.id as string;
                const commentsResponse = await plankaRequest(
                    `/api/cards/${cardId}/comments`,
                );

                if (
                    !commentsResponse ||
                    typeof commentsResponse !== "object" ||
                    !("items" in commentsResponse) ||
                    !Array.isArray(commentsResponse.items)
                ) {
                    continue;
                }

                const comment = commentsResponse.items.find((c) =>
                    typeof c === "object" && c !== null && "id" in c &&
                    (c as { id: unknown }).id === id
                );

                if (comment) {
                    return comment;
                }
            }
        }

        throw new Error(`Comment not found: ${id}`);
    } catch (error) {
        throw new Error(
            `Failed to get comment: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

/**
 * Updates a comment's text content
 *
 * @param {string} id - The ID of the comment to update
 * @param {Partial<Omit<CreateCommentOptions, "cardId">>} options - The properties to update
 * @returns {Promise<object>} The updated comment
 * @throws {Error} If updating the comment fails
 */
export async function updateComment(
    id: string,
    options: Partial<Omit<CreateCommentOptions, "cardId">>,
) {
    try {
        const response = await plankaRequest(`/api/comments/${id}`, {
            method: "PATCH",
            body: {
                text: options.text,
            },
        });
        const parsedResponse = CommentResponseSchema.parse(response);
        return parsedResponse.item;
    } catch (error) {
        throw new Error(
            `Failed to update comment: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}

/**
 * Deletes a comment by ID
 *
 * @param {string} id - The ID of the comment to delete
 * @returns {Promise<{success: boolean}>} Success indicator
 * @throws {Error} If deleting the comment fails
 */
export async function deleteComment(id: string) {
    try {
        await plankaRequest(`/api/comments/${id}`, {
            method: "DELETE",
        });
        return { success: true };
    } catch (error) {
        throw new Error(
            `Failed to delete comment: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
    }
}
