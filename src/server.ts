import { AppConfig } from "./config/app.config";
import { App } from "./app";
import { logger } from "./utils/logger";

// Reload configuration on change

function bootstrap() {
  const config = AppConfig.get();
  const validation = AppConfig.validate(config);

  if (validation.warnings.length > 0) {
    logger.warn("Configuration notices:");
    validation.warnings.forEach((warn) => logger.warn(`  • ${warn}`));
  }

  const appInstance = new App(config);
  const server = appInstance.app.listen(config.port, () => {
    logger.info("=============================================================");
    logger.info("🚀 Hashtagg FreJun One-Click Calling Server Started");
    logger.info(`🌐 Local Server:       http://localhost:${config.port}`);
    logger.info(`📱 Dialing UI:         http://localhost:${config.port}/`);
    logger.info(`📞 Outbound Calls API: POST http://localhost:${config.port}/api/calls`);
    logger.info(`📡 Call Flow URL:     POST ${config.publicBaseUrl}/api/teler/flow`);
    logger.info(`🔔 Status Webhook:     POST ${config.publicBaseUrl}/api/teler/status`);
    logger.info(`🛠️ Configured Action:  ${config.frejun.flowAction.toUpperCase()}`);
    if (config.frejun.flowAction === "dial") {
      logger.info(`🔗 Dial Bridge Target: ${config.frejun.dialBridgeTarget || "(not set)"}`);
    } else if (config.frejun.flowAction === "play") {
      logger.info(`🎵 Flow Media URL:     ${config.frejun.flowMediaUrl}`);
    }
    logger.info("=============================================================");

    if (config.publicBaseUrl.includes("localhost")) {
      logger.info("💡 To receive live FreJun callbacks during local development:");
      logger.info(`   Run: ngrok http ${config.port}`);
      logger.info("   Then update PUBLIC_BASE_URL in your .env with the https ngrok URL.");
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(`❌ Port ${config.port} is already in use by another process!`);
      logger.error(`   Please change PORT in your .env (e.g. PORT=3001) or terminate the conflicting process.`);
    } else {
      logger.error(`❌ Server error: ${err.message}`);
    }
    process.exit(1);
  });

  // Graceful shutdown handling
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
      logger.info("HTTP server closed. Exiting process.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap();
