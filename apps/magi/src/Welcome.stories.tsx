import { Button } from "@workspace/ayamai-design-system/components/ui/button";
export default { title: "MAGI/Project 001", tags: ["autodocs"] };
export const Foundation = {
  render: () => (
    <section className="magi-stack">
      <p className="magi-label">Ayamai / Design laboratory</p>
      <h1 className="magi-title">MAGI</h1>
      <h2 className="text-2xl">Project 001: Foundation</h2>
      <p>
        A place to make visual decisions with real Ayamai components. The
        approved identity stays fixed; typography and composition candidates
        stay open for review.
      </p>
      <div className="magi-grid">
        {[
          [
            "01 / Compare typography",
            "Identical UI, two voices. Change size, weight and tracking; inspect both fonts together.",
            "typography-playground-paired-ui--current-versus-proposed",
          ],
          [
            "02 / Browse a library study",
            "Search, save, switch grid/list, and inspect portrait and landscape media.",
            "compositions-library-explorations--media-cards-and-controls",
          ],
          [
            "03 / Inspect the foundations",
            "Every current semantic color token, both themes, and its intended role.",
            "foundations-design-settings--semantic-colors",
          ],
          [
            "04 / Test component states",
            "Inspect focus, selection, disabled and invalid states on existing primitives.",
            "foundations-design-settings--component-states",
          ],
        ].map(([title, description, id]) => (
          <article key={id} className="magi-stack">
            <h3 className="text-xl">{title}</h3>
            <p>{description}</p>
            <Button variant="outline" asChild>
              <a href={`/?path=/story/${id}`} target="_top">
                Open study
              </a>
            </Button>
          </article>
        ))}
      </div>
      <p>
        Use the viewport toolbar for Desktop · 1440, Tablet · 768 and Mobile ·
        390. Mobile starting-size stories are fixed presets; return to the main
        comparison or Library story for freely switchable sizes. Compare the
        existing dark and light themes with the theme toolbar.
      </p>
      <p>
        Review prompts: Does the serif still read clearly at 28px? Do long
        titles wrap well? Is the sans comfortable in navigation and small
        controls? Does metadata remain distinct? Can you reach every action with
        a keyboard and on a narrow screen?
      </p>
      <p>
        Source of truth: the existing design-system package, its tokens and
        shared CSS. Compositions contain only synthetic placeholders, local
        state and real shared primitives. No API, auth, database or production
        data. Candidate fonts and layouts do not modify the application.
      </p>
    </section>
  ),
};
