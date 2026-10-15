import { Router } from "express";
import { CrmController } from "../controllers/crm.controller";

export function createCrmRoutes(crmController: CrmController): Router {
  const router = Router();

  // Creators (Agents)
  router.get("/creators", crmController.getCreators);
  router.post("/creators", crmController.createCreator);
  router.delete("/creators/:id", crmController.deleteCreator);
  router.post("/creators/:id/activate", crmController.activateCreator);

  // Candidates (Leads / Customers)
  router.get("/candidates", crmController.getCandidates);
  router.post("/candidates", crmController.createCandidate);
  router.delete("/candidates/:id", crmController.deleteCandidate);

  return router;
}
