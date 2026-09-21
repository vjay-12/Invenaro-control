import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { verifyLicense, VerifyError } from "../services/licenseService.js";

const router = Router();

const VerifyRequestBodySchema = z.object({
  licenseKey: z.string({ required_error: "licenseKey is required" }),
  domain: z.string({ required_error: "domain is required" }),
  appVersion: z.string({ required_error: "appVersion is required" }),
});

router.post(
  "/v1/licenses/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = VerifyRequestBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        const errorMessages = parseResult.error.errors
          .map((e) => e.message)
          .join(", ");
        res.status(400).json({
          error: "invalid_request",
          message: errorMessages,
        });
        return;
      }

      const { licenseKey, domain, appVersion } = parseResult.data;

      // Safe logging without leaking secret key
      const keyPrefix = licenseKey.slice(0, 8);
      console.log(
        `[Verify] Processing verification for prefix: ${keyPrefix}..., domain: ${domain}, appVersion: ${appVersion}`
      );

      const result = await verifyLicense({
        licenseKey,
        domain,
        appVersion,
      });

      res.status(200).json(result);
    } catch (error) {
      if (error instanceof VerifyError) {
        res.status(error.statusCode).json({
          error: error.errorCode,
          message: error.message,
        });
        return;
      }
      next(error);
    }
  }
);

export default router;
