import { z } from "zod";
import { prisma } from "../../src/db.js";
import { recordAuditLog } from "../../src/services/audit.js";

const CustomerCreateSchema = z.object({
  name: z.string().min(1, "Customer name is required"),
  domain: z.string().min(1, "Domain is required"),
  notes: z.string().optional(),
});

export async function customerCreateCommand(options: {
  name?: string;
  domain?: string;
  notes?: string;
}) {
  const parsed = CustomerCreateSchema.safeParse(options);
  if (!parsed.success) {
    console.error("❌ Invalid options:");
    parsed.error.errors.forEach((e) => console.error(`   - ${e.message}`));
    process.exit(1);
  }

  const { name, domain, notes } = parsed.data;

  try {
    const customer = await prisma.customer.create({
      data: {
        companyName: name,
        notes: notes || null,
        deployments: {
          create: {
            domain: domain.trim().toLowerCase(),
            allowedDomains: [domain.trim().toLowerCase()],
          },
        },
      },
      include: {
        deployments: true,
      },
    });

    await recordAuditLog({
      action: "customer:create",
      entityType: "Customer",
      entityId: customer.id,
      after: {
        id: customer.id,
        companyName: customer.companyName,
        status: customer.status,
        domain: customer.deployments[0]?.domain,
      },
    });

    console.log("✅ Customer created successfully:");
    console.log(`   Customer ID: ${customer.id}`);
    console.log(`   Company:     ${customer.companyName}`);
    console.log(`   Status:      ${customer.status}`);
    console.log(`   Domain:      ${customer.deployments[0]?.domain}`);
  } catch (error) {
    console.error("❌ Failed to create customer:", error);
    process.exit(1);
  }
}
