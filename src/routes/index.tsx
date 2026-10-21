import { createFileRoute } from "@tanstack/react-router";
import { SaucerGame } from "@/components/saucer-game";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <SaucerGame />;
}
