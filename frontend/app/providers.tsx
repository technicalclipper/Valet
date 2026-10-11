"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { monad } from "../lib/chain/client";

/**
 * Privy supplies the recipient's key, and that is the whole of its job here.
 *
 * Embedded-wallet keys cannot be exported, so the key an issuer signs an
 * escalation with is one the agent it is constraining structurally cannot hold.
 * The guarantee is not "a human is present now" but "this key cannot be handed
 * over" — which is the one an approval actually needs.
 *
 * Note what is NOT configured: smart wallets and a paymaster. The recipient
 * never sends a transaction — claiming, pausing and handing back are all
 * relayed signatures — so there is no bundler in the path and no gas-credit
 * balance to run empty during a demo.
 */
export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Without an app id the app still has to render: most of it is read-only
  // against the chain, and a missing key should not blank the page.
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["google", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#C2B5FF",
          logo: undefined,
          walletList: [],
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true,
        },
        defaultChain: monad,
        supportedChains: [monad],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
