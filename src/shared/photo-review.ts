import { z } from "zod";

/** Approximate placement is a valid reconstruction result, not a missing-evidence failure. */
export const photoObjectSchema = z
  .object({
    objectId: z.string().regex(/^[a-z][a-z0-9_-]{2,99}$/),
    name: z.string().min(1).max(120),
    action: z.enum(["added", "updated", "unchanged", "deferred", "excluded"]),
    observation: z.string().min(1).max(2000),
    reason: z.string().max(2000).default(""),
    nextUpdate: z.string().max(2000).default(""),
    placement: z
      .object({
        sceneId: z.string().min(1).max(100),
        position: z.object({ x: z.number().finite(), y: z.number().finite() }),
        rotationDegrees: z.number().finite().min(0).lt(360),
        dimensionsMeters: z.object({
          width: z.number().finite().positive(),
          depth: z.number().finite().positive(),
          height: z.number().finite().positive(),
        }),
        support: z.enum(["floor", "wall", "ceiling", "surface"]),
        collision: z.enum(["solid", "none"]),
        accuracy: z.enum(["approximate", "confirmed"]),
        locationBasis: z.string().min(1).max(2000),
        scaleBasis: z.string().min(1).max(2000),
      })
      .optional(),
  })
  .superRefine((object, context) => {
    if (["added", "updated"].includes(object.action) && !object.placement)
      context.addIssue({
        code: "custom",
        path: ["placement"],
        message:
          "An added or updated object needs a map placement; an approximate placement is sufficient",
      });
    if (
      ["deferred", "excluded"].includes(object.action) &&
      !object.reason.trim()
    )
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Explain why a recognizable object was not included",
      });
  });

export const photoReviewSchema = z.object({
  photos: z.array(
    z.object({
      id: z.string().uuid(),
      outcome: z.enum(["applied", "unchanged", "needs-evidence", "failed"]),
      observations: z.string().min(1).max(4000),
      changes: z.string().max(4000),
      sourceIds: z.array(z.number()),
      uncertainties: z.string().max(4000),
      // Optional for pre-inventory reports; prepare includes it in new tasks.
      objects: z
        .array(photoObjectSchema)
        .default([])
        .superRefine((objects, context) => {
          if (new Set(objects.map((o) => o.objectId)).size !== objects.length)
            context.addIssue({
              code: "custom",
              message:
                "Use one entry per physical object; repeated photos must reference its stable objectId",
            });
        }),
      evidence: z
        .object({
          before: z.string(),
          after: z.string(),
          sceneId: z.string(),
          view: z.string().min(1),
          zoom: z.number().positive(),
          visualChecked: z.literal(true),
        })
        .optional(),
    }),
  ),
});
export type PhotoReview = z.infer<typeof photoReviewSchema>;
export function hasLocatedPhotoChange(photo: PhotoReview["photos"][number]) {
  return (
    photo.sourceIds.length > 0 ||
    photo.objects.some(
      (object) =>
        (object.action === "added" || object.action === "updated") &&
        object.placement,
    )
  );
}
