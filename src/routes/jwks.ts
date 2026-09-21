import { Router, Request, Response } from "express";
import { getPublicJwks } from "../services/tokenService.js";

const router = Router();

router.get("/.well-known/jwks.json", async (_req: Request, res: Response) => {
  try {
    const jwks = await getPublicJwks();
    res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.status(200).json(jwks);
  } catch (error) {
    res.status(500).json({
      error: "jwks_unavailable",
      message: "Unable to retrieve public signing keys",
    });
  }
});

export default router;
