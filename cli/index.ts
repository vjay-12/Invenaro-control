#!/usr/bin/env node
import { Command } from "commander";
import { customerCreateCommand } from "./commands/customerCreate.js";
import { licenseCreateCommand } from "./commands/licenseCreate.js";
import { licenseShowCommand } from "./commands/licenseShow.js";
import { licenseSetPlanCommand } from "./commands/licenseSetPlan.js";
import { licenseSetModuleCommand } from "./commands/licenseSetModule.js";
import { licenseRenewCommand } from "./commands/licenseRenew.js";
import { licenseSuspendCommand } from "./commands/licenseSuspend.js";
import { licenseReinstateCommand } from "./commands/licenseReinstate.js";
import { deploymentSetCommand } from "./commands/deploymentSet.js";
import { listCustomersCommand } from "./commands/listCustomers.js";
import { emailTestCommand } from "./commands/emailTest.js";
import {
  adminCreateCommand,
  adminResetPasswordCommand,
  adminDisable2faCommand,
  adminListCommand,
} from "./commands/adminCommands.js";

const program = new Command();

program
  .name("invenaro-cli")
  .description("Invenaro Control - Licensing and Customer Administration CLI")
  .version("0.1.0");

// customer:create --name --domain [--notes] [--contact-name] [--contact-email] [--contact-phone]
program
  .command("customer:create")
  .description("Register a new customer with their primary domain")
  .requiredOption("--name <name>", "Company name")
  .requiredOption("--domain <domain>", "Primary customer deployment domain")
  .option("--notes <notes>", "Optional notes")
  .option("--contact-name <name>", "Contact person name")
  .option("--contact-email <email>", "Contact email address")
  .option("--contact-phone <phone>", "Contact phone number")
  .action((opts) => customerCreateCommand(opts));

// license:create --customer <id> --plan <plan> --expires <YYYY-MM-DD> [--grace 14]
program
  .command("license:create")
  .description("Generate a new license key and record for a customer")
  .requiredOption("--customer <id>", "Customer ID")
  .requiredOption("--plan <plan>", "Plan: basic | business | enterprise")
  .requiredOption("--expires <date>", "Expiry date (YYYY-MM-DD)")
  .option("--grace <days>", "Grace period in days", "14")
  .action((opts) => licenseCreateCommand(opts));

// license:show <licenseId|keyPrefix>
program
  .command("license:show <identifier>")
  .description("Display details, status, and effective modules for a license")
  .action((identifier) => licenseShowCommand(identifier));

// license:set-plan <id> <plan>
program
  .command("license:set-plan <id> <plan>")
  .description("Change the plan tier for an existing license")
  .action((id, plan) => licenseSetPlanCommand(id, plan));

// license:set-module <id> <module> <on|off>
program
  .command("license:set-module <id> <module> <state>")
  .description("Override a specific module on or off for a license")
  .action((id, module, state) => licenseSetModuleCommand(id, module, state));

// license:renew <id> --expires <YYYY-MM-DD>
program
  .command("license:renew <id>")
  .description("Extend the expiration date for a license")
  .requiredOption("--expires <date>", "New expiry date (YYYY-MM-DD)")
  .action((id, opts) => licenseRenewCommand(id, opts));

// license:suspend <id>
program
  .command("license:suspend <id>")
  .description("Immediately suspend a license")
  .action((id) => licenseSuspendCommand(id));

// license:reinstate <id>
program
  .command("license:reinstate <id>")
  .description("Reinstate a suspended license to active")
  .action((id) => licenseReinstateCommand(id));

// deployment:set <customerId> --domain --allowed-domains a,b --wave 1 --auto-deploy true|false --vercel-project --neon-project --region
program
  .command("deployment:set <customerId>")
  .description("Configure deployment parameters, allowed domains, and wave rollout")
  .requiredOption("--domain <domain>", "Primary deployment domain")
  .option("--allowed-domains <domains>", "Comma-separated list of allowed domains")
  .option("--wave <number>", "Rollout wave", "1")
  .option("--auto-deploy <bool>", "Auto deploy enabled", "true")
  .option("--vercel-project <id>", "Vercel Project ID")
  .option("--neon-project <id>", "Neon Project ID")
  .option("--region <region>", "Deployment Region")
  .action((customerId, opts) => deploymentSetCommand(customerId, opts));

// list:customers
program
  .command("list:customers")
  .description("List all customers, licenses, and deployments")
  .action(() => listCustomersCommand());

// email:test
program
  .command("email:test")
  .description("Send a test verification email to ADMIN_EMAIL over Gmail SMTP")
  .action(() => emailTestCommand());

// admin:create --email <email> [--force-additional]
program
  .command("admin:create")
  .description("Register a new administrator account with a temporary password")
  .requiredOption("--email <email>", "Administrator email address")
  .option("--force-additional", "Allow creating additional administrators", false)
  .action((opts) => adminCreateCommand(opts));

// admin:reset-password --email <email>
program
  .command("admin:reset-password")
  .description("Reset an administrator's password to a temporary password and revoke sessions")
  .requiredOption("--email <email>", "Administrator email address")
  .action((opts) => adminResetPasswordCommand(opts));

// admin:disable-2fa --email <email> --yes
program
  .command("admin:disable-2fa")
  .description("Emergency recovery command to disable 2FA for an administrator")
  .requiredOption("--email <email>", "Administrator email address")
  .option("--yes", "Confirmation flag to execute 2FA removal", false)
  .action((opts) => adminDisable2faCommand(opts));

// admin:list
program
  .command("admin:list")
  .description("List all registered administrators and their security statuses")
  .action(() => adminListCommand());

program.parse(process.argv);
