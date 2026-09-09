import { createFileRoute, Link } from "@tanstack/react-router";
import { useMe } from "@/lib/me-context";
import { VehicleGlance } from "@/components/erp/VehicleBoard";

export const Route = createFileRoute("/dispatch")({
  head: () => ({
    meta: [{ title: "Dispatch · Avighna" }],
  }),
  component: Dispatch,
});

function Dispatch() {
  const { me } = useMe();
  if (me?.user.role === "logistics") {
    return <p className="text-sm text-muted-foreground">Your assigned drops are on Today / Runs after Sales or Supervisor books a truck for an order.</p>;
  }
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Truck windows</h1>
      <p className="text-sm text-muted-foreground">
        Preview only. Book a truck from <Link to="/ops" className="font-medium text-primary">Order desk</Link> by assigning an invoiced order (date + morning/afternoon/evening + vehicle).
      </p>
      <VehicleGlance />
    </div>
  );
}
