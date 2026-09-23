import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, CircleHelp, Sparkles } from "lucide-react";
import { useMe } from "@/lib/me-context";
import { guideForRole } from "@/lib/user-guide";
import { startTour } from "@/lib/product-tour";
import { PageHeader, Panel } from "@/components/erp/ui-bits";

export const Route = createFileRoute("/guide")({
  head: () => ({
    meta: [{ title: "Guide · Avighna" }],
  }),
  component: GuidePage,
});

function GuidePage() {
  const { me } = useMe();
  const navigate = useNavigate();
  const role = me?.user.role || "";
  const guide = guideForRole(role);
  const roleLabel = role.replaceAll("_", " ") || "user";

  function beginWalkthrough() {
    startTour(role);
    void navigate({ to: "/" });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={guide.title}
        subtitle={`${guide.summary} Signed in as ${roleLabel}.`}
        action={
          <button
            type="button"
            onClick={beginWalkthrough}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            <Sparkles className="size-4" />
            Start walkthrough
          </button>
        }
      />

      <Panel title="On-screen walkthrough" hint="Highlights real sections">
        <p className="text-sm text-muted-foreground">
          Walkthrough dims the page and explains each container on your home screen, then opens every page in your role and explains what it is for.
        </p>
        <button
          type="button"
          onClick={beginWalkthrough}
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold sm:w-auto sm:px-5"
        >
          <Sparkles className="size-4" />
          Start walkthrough
        </button>
      </Panel>

      <Panel title="Order flow" hint="Who does what">
        <ol className="space-y-2">
          {guide.flow.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold">
                {i + 1}
              </span>
              <span className="pt-1 leading-snug">{step}</span>
            </li>
          ))}
        </ol>
      </Panel>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">
          All your pages — tap to open
        </h2>
        <ul className="space-y-3">
          {guide.screens.map((s, i) => (
            <li key={`${s.to}-${s.label}`}>
              <Link
                to={s.to}
                className="block rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:border-primary/40 hover:bg-secondary/30 active:scale-[0.99]"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">{s.label}</p>
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                        Open
                        <ArrowRight className="size-3.5" />
                      </span>
                    </div>
                    <p className="mt-1 text-sm">
                      <span className="font-medium text-foreground">What for: </span>
                      <span className="text-muted-foreground">{s.purpose}</span>
                    </p>
                    <p className="mt-1 text-sm">
                      <span className="font-medium text-foreground">How to use: </span>
                      <span className="text-muted-foreground">{s.how}</span>
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleHelp className="size-3.5" />
        Prefer the guided tour? Use Start walkthrough above.
      </p>
    </div>
  );
}
