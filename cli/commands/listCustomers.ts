import { prisma } from "../../src/db.js";

export async function listCustomersCommand() {
  try {
    const customers = await prisma.customer.findMany({
      include: {
        licenses: true,
        deployments: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (customers.length === 0) {
      console.log("No customers registered yet. Create one with `npm run cli customer:create -- --name <name> --domain <domain>`");
      return;
    }

    console.log("================================================================================");
    console.log(`📋 REGISTERED CUSTOMERS (${customers.length})`);
    console.log("================================================================================");

    for (const c of customers) {
      console.log(`\n🏢 ${c.companyName} [ID: ${c.id}]`);
      console.log(`   Status:  ${c.status.toUpperCase()}`);
      console.log(`   Created: ${c.createdAt.toISOString().slice(0, 10)}`);

      if (c.deployments.length > 0) {
        console.log("   Deployments:");
        c.deployments.forEach((d) => {
          const lastSeen = d.lastSeenAt ? d.lastSeenAt.toISOString() : "never";
          console.log(`     - Domain: ${d.domain} | Allowed: [${d.allowedDomains.join(", ")}] | Wave: ${d.rolloutWave} | Last Seen: ${lastSeen} | Version: ${d.appVersion || "unknown"}`);
        });
      } else {
        console.log("   Deployments: (none)");
      }

      if (c.licenses.length > 0) {
        console.log("   Licenses:");
        c.licenses.forEach((l) => {
          console.log(`     - KeyPrefix: ${l.keyPrefix}... | ID: ${l.id} | Plan: ${l.plan} | Status: ${l.status} | Expires: ${l.expiresAt.toISOString().slice(0, 10)} (+${l.graceDays}d grace)`);
        });
      } else {
        console.log("   Licenses: (none)");
      }
    }
    console.log("\n================================================================================");
  } catch (error) {
    console.error("❌ Failed to list customers:", error);
    process.exit(1);
  }
}
