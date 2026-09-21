import { getConfig } from "../../src/config.js";
import { sendAdminEmail } from "../../src/services/email.js";

export async function emailTestCommand() {
  console.log("📧 Testing email configuration over Gmail SMTP...\n");

  const config = getConfig();

  if (!config.ADMIN_EMAIL) {
    console.error("❌ ADMIN_EMAIL is not set in environment.");
    process.exit(1);
  }
  if (!config.SMTP_USER || !config.SMTP_PASS) {
    console.error("❌ SMTP_USER or SMTP_PASS is not set in environment.");
    process.exit(1);
  }

  const result = await sendAdminEmail({
    event: "test_email",
    subject: "SMTP Verification Test",
    text: "This is a verification test email sent from the Invenaro Control CLI to confirm your Gmail SMTP configuration.",
    html: "<p>This is a verification test email sent from the Invenaro Control CLI to confirm your Gmail SMTP configuration.</p>",
  });

  if (result.status === "sent") {
    console.log("✅ Test email sent successfully!");
    console.log("   Check the inbox of:", config.ADMIN_EMAIL);
  } else if (result.status === "skipped") {
    console.warn("⚠️  Email send was skipped. (EMAIL_ENABLED may be false).");
  } else {
    console.error("❌ Failed to send email:");
    console.error("   Error:", result.error || "Unknown error occurred.");
    console.error("\nTip: For Gmail, ensure 2-Step Verification is ON and generate an App Password.");
    process.exit(1);
  }
}
