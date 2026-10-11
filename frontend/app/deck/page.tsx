import type { Metadata } from "next";
import { Deck } from "./Deck";

export const metadata: Metadata = {
  title: "Valet — the pitch",
  description: "Trust an agent with money, without handing it your keys. Ten slides.",
};

export default function DeckPage() {
  return <Deck />;
}
