import { getAddress, type Address } from "viem";
import { publicClient } from "./client";
import { logs } from "./eventIndex";
import { readCapsule, readHeadroom, readVault, type OnChainCapsule } from "./reads";

export type Status = "running" | "waiting" | "paused" | "ended";

export interface MyCapsule {
  id: string;
  capsule: OnChainCapsule;
  vaultBalance: bigint;
  vaultRevoked: boolean;
  windowIndex: bigint;
  status: Status;
  endedBecause?: string;
  asIssuer: boolean;
  asRecipient: boolean;
}

/**
 * Every capsule a wallet issued or receives, found from the chain's own events.
 *
 * No index of our own: what you sent is the capsules minted against vaults you
 * opened, and what you receive is the capsules minted with you as principal.
 * Both come from the server's event index — a copy of the chain's logs, read in
 * ranges the RPC will serve — so this runs on the server and /api/mine serves it.
 */
export async function findMine(who: Address): Promise<MyCapsule[]> {
  // An address typed or pasted by a person can have checksum casing that does
  // not match — viem rejects those outright. Lowercasing first and recomputing
  // the checksum accepts any spelling of a valid address.
  const me = getAddress(who.toLowerCase());
  const [opened, forMe] = await Promise.all([
    logs({ eventName: "VaultOpened", args: { issuer: me } }),
    logs({ eventName: "CapsuleMinted", args: { principal: me } }),
  ]);
  const myVaults = opened.map((l) => l.args.vaultId as bigint);
  const fromMyVaults = myVaults.length ? await logs({ eventName: "CapsuleMinted", args: { vaultId: myVaults } }) : [];

  const ids = new Set<string>();
  for (const l of [...forMe, ...fromMyVaults]) ids.add(String(l.args.capsuleId));

  const now = BigInt((await publicClient.getBlock()).timestamp);
  const rows = await Promise.all(
    [...ids].map(async (id): Promise<MyCapsule> => {
      const capsule = await readCapsule(BigInt(id));
      const [vault, head] = await Promise.all([readVault(capsule.vaultId), readHeadroom(BigInt(id))]);
      const b = capsule.bounds;
      const lower = me.toLowerCase();
      const ended =
        capsule.revoked ? "revoked by the issuer"
          : capsule.surrendered ? "handed back by the recipient"
            : vault.revoked ? "the vault was closed and the money returned"
              : now >= b.expiresAt ? "its term ended"
                : capsule.spentTotal >= b.totalCap ? "it reached its lifetime cap"
                  : undefined;
      const status: Status = ended
        ? "ended"
        : capsule.holder === "0x0000000000000000000000000000000000000000"
          ? "waiting"
          : capsule.pausedByIssuer || capsule.pausedByPrincipal
            ? "paused"
            : "running";
      return {
        id, capsule, vaultBalance: vault.balance, vaultRevoked: vault.revoked,
        windowIndex: head.windowIndex, status, endedBecause: ended,
        asIssuer: capsule.issuer.toLowerCase() === lower,
        asRecipient: capsule.principal.toLowerCase() === lower,
      };
    }),
  );
  return rows.sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));
}
