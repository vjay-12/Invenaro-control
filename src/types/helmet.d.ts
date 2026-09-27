declare module "helmet" {
  import { IncomingMessage, ServerResponse } from "node:http";

  export type CustomCspDirectiveFn = (req: IncomingMessage, res: ServerResponse) => string;
  export type CustomCspDirectiveValue = string | CustomCspDirectiveFn;

  export interface ContentSecurityPolicyDirectives {
    defaultSrc?: Iterable<CustomCspDirectiveValue>;
    styleSrc?: Iterable<CustomCspDirectiveValue>;
    styleSrcAttr?: Iterable<CustomCspDirectiveValue>;
    scriptSrc?: Iterable<CustomCspDirectiveValue>;
    imgSrc?: Iterable<CustomCspDirectiveValue>;
    formAction?: Iterable<CustomCspDirectiveValue>;
    frameAncestors?: Iterable<CustomCspDirectiveValue>;
    baseUri?: Iterable<CustomCspDirectiveValue>;
    [key: string]: Iterable<CustomCspDirectiveValue> | undefined;
  }

  export interface HelmetOptions {
    contentSecurityPolicy?: {
      directives?: ContentSecurityPolicyDirectives;
      reportOnly?: boolean;
    } | boolean;
    referrerPolicy?: {
      policy?: string | string[];
    } | boolean;
    crossOriginEmbedderPolicy?: boolean | object;
    crossOriginOpenerPolicy?: boolean | object;
    crossOriginResourcePolicy?: boolean | object;
    originAgentCluster?: boolean;
    strictTransportSecurity?: boolean | object;
    xContentTypeOptions?: boolean;
    xDnsPrefetchControl?: boolean | object;
    xDownloadOptions?: boolean;
    xFrameOptions?: boolean | object;
    xPermittedCrossDomainPolicies?: boolean | object;
    xPoweredBy?: boolean;
    xXssProtection?: boolean;
    [key: string]: unknown;
  }

  export interface Helmet {
    (options?: Readonly<HelmetOptions>): (
      req: IncomingMessage,
      res: ServerResponse,
      next: (err?: unknown) => void
    ) => void;
    contentSecurityPolicy: (options?: unknown) => (
      req: IncomingMessage,
      res: ServerResponse,
      next: () => void
    ) => void;
    [key: string]: unknown;
  }

  const helmet: Helmet;
  export default helmet;
}
