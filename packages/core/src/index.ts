export type CapabilityRisk = "read" | "write" | "execute";

export interface CapabilityDescriptor {
  name: string;
  description: string;
  risk: CapabilityRisk;
}

export const builtinCapabilities: readonly CapabilityDescriptor[] = [
  { name: "system.ping", description: "Confirm MCP reachability.", risk: "read" },
] as const;
