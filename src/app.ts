import express, { Application } from "express";
import cors from "cors";
import path from "node:path";
import { IAppConfig } from "./config/app.config";
import { rawBodySaver } from "./middleware/raw-body.middleware";
import { requestLogger } from "./middleware/logger.middleware";
import { errorHandler } from "./middleware/error.middleware";
import { ITelephonyService } from "./services/interfaces/telephony.service.interface";
import { FreJunService } from "./services/frejun.service";
import { ICallRepository } from "./services/interfaces/call.repository.interface";
import { InMemoryCallRepository } from "./services/call.repository";
import { IDeduplicationService } from "./services/interfaces/deduplication.service.interface";
import { MemoryDeduplicationService } from "./services/deduplication.service";
import { CallController } from "./controllers/call.controller";
import { WebhookController } from "./controllers/webhook.controller";
import { HealthController } from "./controllers/health.controller";
import { createCallRoutes } from "./routes/call.routes";
import { createWebhookRoutes } from "./routes/webhook.routes";
import { Logger } from "./utils/logger";

import { ICrmRepository, InMemoryCrmRepository } from "./services/crm.repository";
import { CrmController } from "./controllers/crm.controller";
import { createCrmRoutes } from "./routes/crm.routes";

export class App {
  public app: Application;
  public config: IAppConfig;
  public telephonyService: ITelephonyService;
  public callRepository: ICallRepository;
  public deduplicationService: IDeduplicationService;
  public crmRepository: ICrmRepository;
  private logger = new Logger("App");

  constructor(config: IAppConfig) {
    this.config = config;
    this.app = express();

    // 1. Initialize Services & Repositories (Dependency Injection)
    this.telephonyService = new FreJunService(this.config);
    this.callRepository = new InMemoryCallRepository();
    this.crmRepository = new InMemoryCrmRepository();
    this.deduplicationService = new MemoryDeduplicationService(
      this.config.callSettings.duplicateCooldownSeconds
    );

    // 2. Setup Middlewares
    this.setupMiddlewares();

    // 3. Setup Routes
    this.setupRoutes();

    // 4. Setup Error Handling
    this.setupErrorHandling();
  }

  private setupMiddlewares(): void {
    this.app.use(cors());

    // IMPORTANT: Capture raw body buffer for HMAC-SHA256 signature verification
    this.app.use(
      express.json({
        verify: rawBodySaver,
        limit: "1mb",
      })
    );

    this.app.use(express.urlencoded({ extended: true }));

    // Structured Request Logging
    this.app.use(requestLogger);

    // Serve Frontend Dialing UI
    const publicDir = path.join(__dirname, "public");
    this.app.use(express.static(publicDir));
  }

  private setupRoutes(): void {
    // Controllers
    const healthController = new HealthController(this.config);
    const callController = new CallController(
      this.telephonyService,
      this.callRepository,
      this.deduplicationService,
      this.crmRepository
    );
    const webhookController = new WebhookController(
      this.telephonyService,
      this.callRepository,
      this.deduplicationService,
      this.crmRepository
    );
    const crmController = new CrmController(this.crmRepository);

    // Health
    this.app.get("/api/health", healthController.check);

    // Outbound Calls API
    this.app.use("/api/calls", createCallRoutes(callController, this.deduplicationService));

    // Initial and background periodic sync from FreJun Integrations API (every 8 seconds)
    callController.syncCallsInternal().catch(() => {});
    setInterval(() => {
      callController.syncCallsInternal().catch(() => {});
    }, 8000);

    // Multi-Creator & Multi-Candidate CRM API
    this.app.use("/api/crm", createCrmRoutes(crmController));

    // FreJun Call Flow and Webhook endpoints under /api/teler
    this.app.use("/api/teler", createWebhookRoutes(webhookController));

    // Aliases for quickstart default paths (/flow, /status, /webhook)
    this.app.post("/flow", webhookController.handleCallFlow);
    this.app.get("/flow", webhookController.handleCallFlow);
    this.app.post("/status", webhookController.handleStatusWebhook);
    this.app.post("/webhook", webhookController.handleStatusWebhook);
    this.app.post("/api/webhook", webhookController.handleStatusWebhook);

    // SPA fallback to index.html for root path
    this.app.get("/", (_req, res) => {
      res.sendFile(path.join(__dirname, "public", "index.html"));
    });
  }

  private setupErrorHandling(): void {
    // Catch-all 404 handler for API routes
    this.app.use((req, res, next) => {
      if (req.path.startsWith("/api/")) {
        res.status(404).json({
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "API endpoint not found.",
          },
        });
        return;
      }
      next();
    });

    // Centralized Error Handling Middleware
    this.app.use(errorHandler);
  }
}
