import { Router } from "express";
import { WebhookController } from "../controllers/webhook.controller";

export function createWebhookRoutes(webhookController: WebhookController): Router {
  const router = Router();

  // FreJun Call Flow instruction callback
  router.post("/flow", webhookController.handleCallFlow);

  // FreJun Call Status Webhook callback (HMAC-verified)
  router.post("/status", webhookController.handleStatusWebhook);

  return router;
}
