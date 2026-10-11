import { getAddress, parseAbiItem, type Address } from "viem";
import { publicClient } from "./client";
import { readCapsule, readHeadroom, readVault, type OnChainCapsule } from "./reads";
import { chain as cfg, valetAddress } from "../config/chain";

const VaultOpened = parseAbiItem("event VaultOpened(uint256 indexed vaultId, address indexed issuer, address asset)");
const CapsuleMinted = parseAbiItem(
  "event CapsuleMinted(uint256 indexed capsuleId, uint256 indexed vaultId, address indexed principal, bytes32 policyHash, uint8 mode)",
);

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
 * Both events index those fields, so this is two or three log queries, not a
 * scan. A server that kept its own list could forget one; the chain cannot.
 */
export async function findMine(who: Address): Promise<MyCapsule[]> {
  // An address typed or pasted by a person can have checksum casing that does
  // not match — viem rejects those outright. Lowercasing first and recomputing
  // the checksum accepts any spelling of a valid address.
  const me = getAddress(who.toLowerCase());
  const address = valetAddress();
  const fromBlock = cfg.deployBlock;

  const [opened, forMe] = await Promise.all([
    publicClient.getLogs({ address, event: VaultOpened, args: { issuer: me }, fromBlock }),
    publicClient.getLogs({ address, event: CapsuleMinted, args: { principal: me }, fromBlock }),
  ]);
  const myVaults = opened.map((l) => l.args.vaultId!).filter((v) => v !== undefined);
  const fromMyVaults = myVaults.length
    ? await publicClient.getLogs({ address, event: CapsuleMinted, args: { vaultId: myVaults }, fromBlock })
    : [];

  const ids = new Set<string>();
  for (const l of [...forMe, ...fromMyVaults]) ids.add(l.args.capsuleId!.toString());

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
