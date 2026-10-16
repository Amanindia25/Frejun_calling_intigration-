import { Router } from "express";
import { CallController, initiateCallSchema } from "../controllers/call.controller";
import { validateBody } from "../middleware/validation.middleware";
import { duplicateCallGuard } from "../middleware/duplicate-call.middleware";
import { IDeduplicationService } from "../services/interfaces/deduplication.service.interface";

export function createCallRoutes(
  callController: CallController,
  deduplicationService: IDeduplicationService
): Router {
  const router = Router();

  // Outbound call initiation with validation and duplicate protection
  router.post(
    "/",
    validateBody(initiateCallSchema),
    duplicateCallGuard(deduplicationService),
    callController.initiateCall
  );

  // Event stream / list of lifecycle events for UI live updates
  router.get("/events", callController.listEvents);

  // List recent calls
  router.get("/", callController.listCalls);

  // Retrieve single call session
  router.get("/:id", callController.getCall);

  // End / hangup active call session
  router.post("/:id/hangup", callController.hangupCall);

  return router;
}
