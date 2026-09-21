import { z } from "zod";
import { prisma } from "../../src/db.js";
import { recordAuditLog } from "../../src/services/audit.js";

const CustomerCreateSchema = z.object({
  name: z.string().min(1, "Customer name is required"),
  domain: z.string().min(1, "Domain is required"),
  notes: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
});

export async function customerCreateCommand(options: {
  name?: string;
  domain?: string;
  notes?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}) {
  const parsed = CustomerCreateSchema.safeParse(options);
  if (!parsed.success) {
    console.error("❌ Invalid options:");
    parsed.error.errors.forEach((e) => console.error(`   - ${e.message}`));
    process.exit(1);
  }

  const { name, domain, notes, contactName, contactEmail, contactPhone } = parsed.data;

  try {
    const customer = await prisma.customer.create({
      data: {
        companyName: name,
        notes: notes || null,
        contactName: contactName || null,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
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
        contactName: customer.contactName,
        contactEmail: customer.contactEmail,
        contactPhone: customer.contactPhone,
      },
    });

    console.log("✅ Customer created successfully:");
    console.log(`   Customer ID: ${customer.id}`);
    console.log(`   Company:     ${customer.companyName}`);
    console.log(`   Status:      ${customer.status}`);
    console.log(`   Domain:      ${customer.deployments[0]?.domain}`);
    if (customer.contactName) console.log(`   Contact:     ${customer.contactName}`);
  } catch (error) {
    console.error("❌ Failed to create customer:", error);
    process.exit(1);
  }
}

