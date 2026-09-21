import { z } from "zod";
import { prisma } from "../../src/db.js";
import { recordAuditLog } from "../../src/services/audit.js";

const DeploymentSetSchema = z.object({
  customerId: z.string().min(1, "Customer ID is required"),
  domain: z.string().min(1, "Domain is required"),
  allowedDomains: z
    .string()
    .optional()
    .transform((val) =>
      val ? val.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : []
    ),
  wave: z.coerce.number().int().default(1),
  autoDeploy: z
    .string()
    .optional()
    .transform((val) => (val !== undefined ? val === "true" || val === "1" : true)),
  vercelProject: z.string().optional(),
  neonProject: z.string().optional(),
  region: z.string().optional(),
});

export async function deploymentSetCommand(
  customerId: string,
  options: {
    domain?: string;
    allowedDomains?: string;
    wave?: string | number;
    autoDeploy?: string;
    vercelProject?: string;
    neonProject?: string;
    region?: string;
  }
) {
  const parsed = DeploymentSetSchema.safeParse({
    customerId,
    ...options,
  });

  if (!parsed.success) {
    console.error("❌ Invalid options:");
    parsed.error.errors.forEach((e) => console.error(`   - ${e.message}`));
    process.exit(1);
  }

  const data = parsed.data;

  try {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      include: { deployments: true },
    });

    if (!customer) {
      console.error(`❌ Customer not found with ID: ${data.customerId}`);
      process.exit(1);
    }

    const domainLower = data.domain.toLowerCase().trim();
    // Default allowedDomains to include domain itself if empty
    const allowed =
      data.allowedDomains.length > 0 ? data.allowedDomains : [domainLower];

    const existingDeployment = customer.deployments.find(
      (d) => d.domain.toLowerCase() === domainLower
    );

    let deployment;
    if (existingDeployment) {
      deployment = await prisma.deployment.update({
        where: { id: existingDeployment.id },
        data: {
          allowedDomains: allowed,
          rolloutWave: data.wave,
          autoDeploy: data.autoDeploy,
          vercelProjectId: data.vercelProject || existingDeployment.vercelProjectId,
          neonProjectId: data.neonProject || existingDeployment.neonProjectId,
          region: data.region || existingDeployment.region,
        },
      });

      await recordAuditLog({
        action: "deployment:update",
        entityType: "Deployment",
        entityId: deployment.id,
        before: {
          allowedDomains: existingDeployment.allowedDomains,
          rolloutWave: existingDeployment.rolloutWave,
          autoDeploy: existingDeployment.autoDeploy,
        },
        after: {
          allowedDomains: deployment.allowedDomains,
          rolloutWave: deployment.rolloutWave,
          autoDeploy: deployment.autoDeploy,
        },
      });
    } else {
      deployment = await prisma.deployment.create({
        data: {
          customerId: data.customerId,
          domain: domainLower,
          allowedDomains: allowed,
          rolloutWave: data.wave,
          autoDeploy: data.autoDeploy,
          vercelProjectId: data.vercelProject || null,
          neonProjectId: data.neonProject || null,
          region: data.region || null,
        },
      });

      await recordAuditLog({
        action: "deployment:create",
        entityType: "Deployment",
        entityId: deployment.id,
        after: {
          customerId: deployment.customerId,
          domain: deployment.domain,
          allowedDomains: deployment.allowedDomains,
          rolloutWave: deployment.rolloutWave,
          autoDeploy: deployment.autoDeploy,
        },
      });
    }

    console.log("✅ Deployment configured successfully:");
    console.log(`   Deployment ID:   ${deployment.id}`);
    console.log(`   Customer ID:     ${deployment.customerId}`);
    console.log(`   Domain:          ${deployment.domain}`);
    console.log(`   Allowed Domains: ${deployment.allowedDomains.join(", ")}`);
    console.log(`   Rollout Wave:    ${deployment.rolloutWave}`);
    console.log(`   Auto Deploy:     ${deployment.autoDeploy}`);
    console.log(`   Vercel Project:  ${deployment.vercelProjectId ?? "(none)"}`);
    console.log(`   Neon Project:    ${deployment.neonProjectId ?? "(none)"}`);
    console.log(`   Region:          ${deployment.region ?? "(none)"}`);
  } catch (error) {
    console.error("❌ Failed to configure deployment:", error);
    process.exit(1);
  }
}
