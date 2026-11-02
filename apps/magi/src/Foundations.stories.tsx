import { Button } from "@workspace/ayamai-design-system/components/ui/button";
import { Input } from "@workspace/ayamai-design-system/components/ui/input";
import { Checkbox } from "@workspace/ayamai-design-system/components/ui/checkbox";
import { Switch } from "@workspace/ayamai-design-system/components/ui/switch";
import { tokens } from "@workspace/ayamai-design-system";
import {
  Search,
  Grid2X2,
  List,
  Play,
  Plus,
  Heart,
  Bookmark,
  Settings,
} from "lucide-react";
import { BrandMark } from "../../../projects/yoru/app/src/components/brand-mark";
export default { title: "Foundations/Design settings", tags: ["autodocs"] };
export const Palette = {
  render: () => (
    <section className="magi-stack">
      <h1 className="magi-title">Approved palette</h1>
      <p>
        Read directly from the existing generated dark tokens. The toolbar also
        previews the existing light theme; it does not replace the approved
        brand palette.
      </p>
      <div className="magi-grid">
        {(
          [
            "background",
            "card",
            "primary",
            "foreground",
            "destructive",
          ] as const
        ).map((key) => (
          <div key={key}>
            <div
              style={{
                background: tokens.color.dark[key],
                height: 120,
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
              }}
            />
            <p>
              {key} Â· {tokens.color.dark[key]}
            </p>
          </div>
        ))}
      </div>
    </section>
  ),
};
export const SpacingAndRadii = {
  render: () => (
    <section className="magi-stack">
      <h1 className="magi-title">Space & shape</h1>
      <p>
        Existing base spacing: {tokens.spacing}. Existing radius:{" "}
        {tokens.radius}. Derived radii come from the shared stylesheet.
      </p>
      {[1, 2, 3, 4, 6, 8, 12, 16].map((n) => (
        <div className="magi-row" key={n}>
          <code>
            {n} Ã— {tokens.spacing}
          </code>
          <div
            style={{
              width: `calc(var(--spacing) * ${n})`,
              height: 16,
              background: "hsl(var(--primary))",
            }}
          />
        </div>
      ))}
      <div className="magi-row">
        {["sm", "md", "lg", "xl"].map((size) => (
          <div
            key={size}
            style={{
              padding: 24,
              border: "1px solid hsl(var(--primary))",
              borderRadius: `var(--radius-${size})`,
            }}
          >
            {size}
          </div>
        ))}
      </div>
    </section>
  ),
};
export const Icons = {
  render: () => (
    <section className="magi-stack">
      <h1 className="magi-title">Product iconography</h1>
      <p>
        Existing lucide-react icon family. Use accessible names on icon-only
        controls; decorative icons should be hidden from assistive technology.
      </p>
      <div className="magi-row">
        {Object.entries({
          Search,
          Grid2X2,
          List,
          Play,
          Plus,
          Heart,
          Bookmark,
          Settings,
        }).map(([name, Icon]) => (
          <div key={name} className="magi-stack">
            <Icon aria-hidden="true" size={24} />
            <code>{name}</code>
          </div>
        ))}
      </div>
    </section>
  ),
};
export const ApprovedAssets = {
  render: () => (
    <section className="magi-stack">
      <h1 className="magi-title">Existing approved assets</h1>
      <p>
        Unmodified files served directly from the application's public/brand
        directory. BrandMark below is the actual application component. Preserve
        the raster artwork and aspect ratios.
      </p>
      <BrandMark title="Ayamai" className="h-16 w-16" />
      <img
        src="/ui/brand/source/wordmark.png"
        alt="Ayamai wordmark"
        style={{ width: 320, maxWidth: "100%", height: "auto" }}
      />
      <img
        src="/ui/brand/source/approved-lockup.png"
        alt="Approved Ayamai lockup"
        style={{ width: 480, maxWidth: "100%", height: "auto" }}
      />
    </section>
  ),
};
export const TypographyCandidates = {
  render: () => (
    <section className="magi-stack">
      <p className="magi-label">Exploration Â· approval pending</p>
      <h1 className="magi-title">Editorial precision</h1>
      <p>
        Bodoni Moda: pointed, high-contrast editorial serif. Space Grotesk:
        sharp functional sans. Both are locally bundled candidates, not approved
        brand fonts. Existing shared typography tokens still use{" "}
        {tokens.fontFamily.sans.join(", ")}; this specimen changes no
        application styles.
      </p>
      {["Bodoni Moda", "Space Grotesk"].map((font) => (
        <article
          className="magi-stack"
          key={font}
          style={{
            fontFamily: `'${font}', ${font === "Bodoni Moda" ? "serif" : "sans-serif"}`,
          }}
        >
          <p>{font} / candidate</p>
          <h2 className="magi-title">A quiet place to get lost.</h2>
          <p>Save what moves you. Find it again. 0123456789</p>
          <p>Aa Bb Cc Dd Ee Ff Gg Â· Library / Collections / Watch</p>
        </article>
      ))}
      <p>Current functional stack</p>
      <h2 className="text-3xl font-sans">A quiet place to get lost.</h2>
    </section>
  ),
};

const roleGroups = {
  "Canvas & reading": [
    "background",
    "foreground",
    "card",
    "cardForeground",
    "popover",
    "popoverForeground",
  ],
  "Actions & emphasis": [
    "primary",
    "primaryForeground",
    "secondary",
    "secondaryForeground",
    "accent",
    "accentForeground",
    "ring",
  ],
  "Supporting detail": [
    "muted",
    "mutedForeground",
    "border",
    "input",
    "overlay",
  ],
  Feedback: [
    "destructive",
    "destructiveForeground",
    "success",
    "successForeground",
    "warning",
    "warningForeground",
  ],
  Navigation: [
    "sidebar",
    "sidebarForeground",
    "sidebarBorder",
    "sidebarPrimary",
    "sidebarPrimaryForeground",
    "sidebarAccent",
    "sidebarAccentForeground",
    "sidebarRing",
  ],
  "Data visualization": ["chart1", "chart2", "chart3", "chart4", "chart5"],
} as const;
const roles: Record<string, string> = {
  background: "Dominant page canvas",
  foreground: "Primary reading text",
  card: "Contained surfaces and structural depth",
  cardForeground: "Text on cards",
  popover: "Floating menus and dialogs",
  popoverForeground: "Text on floating surfaces",
  primary: "Primary action, selection and identity highlights",
  primaryForeground: "Text on primary actions",
  secondary: "Secondary controls and surfaces",
  secondaryForeground: "Text on secondary surfaces",
  accent: "Hover and selected surface emphasis",
  accentForeground: "Text on accent surfaces",
  ring: "Keyboard focus indication",
  muted: "Quiet supporting surfaces",
  mutedForeground: "Secondary descriptions and metadata",
  border: "Structural dividers",
  input: "Form control boundaries",
  overlay: "Underlying overlay tone",
  destructive: "Sparse destructive actions and alerts",
  destructiveForeground: "Text on destructive surfaces",
  success: "Positive feedback",
  successForeground: "Text on success surfaces",
  warning: "Caution feedback",
  warningForeground: "Text on warning surfaces",
};
export const SemanticColors = {
  render: () => (
    <section className="magi-stack">
      <p className="magi-label">
        Authoritative token inventory / current package
      </p>
      <h1 className="magi-title">Color has a job.</h1>
      <p>
        The approved identity palette anchors the dark theme. This complete
        semantic inventory reads both themes directly from the existing token
        package. Roles describe intended use, not permission to restyle the app.
        Validate contrast for each actual pairing; red remains scarce.
      </p>
      {Object.entries(roleGroups).map(([group, keys]) => (
        <div key={group}>
          <h2 className="text-xl">{group}</h2>
          <table className="lab-token-table">
            <thead>
              <tr>
                <th>Token / role</th>
                <th>Dark</th>
                <th>Light</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key}>
                  <td>
                    <strong>{key}</strong>
                    <br />
                    {roles[key] ??
                      (key.startsWith("chart")
                        ? "Categorical data series; supplement color with labels."
                        : "Navigation equivalent of the corresponding surface, text, border, action or focus token.")}
                  </td>
                  {(["dark", "light"] as const).map((theme) => (
                    <td key={theme}>
                      <span
                        className="lab-token-chip"
                        style={{ background: tokens.color[theme][key] }}
                      />
                      <code>{tokens.color[theme][key]}</code>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  ),
};
export const TypeScale = {
  render: () => (
    <section className="magi-stack">
      <h1 className="magi-title">Current type scale</h1>
      <p>
        Existing shared Tailwind scale and unchanged font tokens. Candidate
        pairings are in Typography playground; no token migration has occurred.
      </p>
      {Object.entries(tokens.fontFamily).map(([role, stack]) => (
        <p key={role} style={{ fontFamily: stack.join(",") }}>
          {role}: {stack.join(", ")} · A quiet place to get lost.
        </p>
      ))}
      {[
        ["xs", "12 / metadata"],
        ["sm", "14 / supporting copy"],
        ["base", "16 / body"],
        ["lg", "18 / media title"],
        ["xl", "20 / section title"],
        ["2xl", "24 / collection title"],
        ["3xl", "30 / page heading"],
        ["4xl", "36 / editorial heading"],
        ["5xl", "48 / editorial display"],
      ].map(([size, label]) => (
        <div key={size}>
          <code className="lab-meta">
            {label}px · text-{size}
          </code>
          <p
            className={`text-${size}`}
            style={{
              fontSize: `var(--text-${size})`,
              lineHeight: `var(--text-${size}--line-height)`,
            }}
          >
            Collected fragments.
          </p>
        </div>
      ))}
    </section>
  ),
};
export const IconSizes = {
  render: () => (
    <section className="magi-stack">
      <h1 className="magi-title">Icon rhythm</h1>
      <p>
        Lucide icons at representative sizes. Shared buttons size their child
        icons to 16px. Use a visible label or accessible name; keep decorative
        icons hidden from assistive technology.
      </p>
      <div className="magi-row">
        {[16, 20, 24, 32].map((size) => (
          <div key={size}>
            <Search size={size} aria-hidden="true" />
            <code>{size}px</code>
          </div>
        ))}
      </div>
      <Button>
        <Search aria-hidden="true" />
        Search library
      </Button>
    </section>
  ),
};
export const ComponentStates = {
  render: () => (
    <section className="magi-stack">
      <h1 className="magi-title">State, with meaning.</h1>
      <p>
        Actual shared primitives. Tab through controls to inspect real focus,
        hover with the pointer, and toggle selections. These are working states
        rather than painted imitations.
      </p>
      <div className="magi-row">
        <Button>Default action</Button>
        <Button variant="outline">Secondary action</Button>
        <Button disabled>Unavailable</Button>
        <Button variant="destructive">Delete demo</Button>
      </div>
      <label>
        Default input
        <Input placeholder="Name a collection" />
      </label>
      <label>
        Invalid input
        <Input
          aria-invalid="true"
          aria-describedby="lab-error"
          defaultValue=""
        />
        <span id="lab-error" className="text-destructive">
          A collection name is required.
        </span>
      </label>
      <label>
        Disabled input
        <Input disabled value="Import in progress" readOnly />
      </label>
      <div className="magi-row">
        <label className="magi-row">
          <Checkbox defaultChecked />
          Selected media
        </label>
        <label className="magi-row">
          <Checkbox disabled />
          Unavailable media
        </label>
        <label className="magi-row">
          <Switch defaultChecked />
          Saved only
        </label>
      </div>
    </section>
  ),
};
