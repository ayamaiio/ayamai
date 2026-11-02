import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  LibraryStudy,
  CollectionStudy,
  typeStyle,
  type TypeOptions,
} from "./laboratory";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@workspace/ayamai-design-system/components/ui/tabs";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
function Playground(args: TypeOptions) {
  return (
    <div className="lab-playground">
      <header className="lab-intro">
        <p className="magi-label">MAGI / Typography decision desk</p>
        <h1 className="magi-title">Same archive. Two voices.</h1>
        <p>
          Current Inter versus candidate Bodoni Moda headings + Space Grotesk
          UI. IBM Plex Mono remains the technical voice. Identical shared
          components and content make density, wrapping and hierarchy
          comparable.
        </p>
        <p className="lab-meta">
          Candidates only · Adjust heading size, weight and tracking in Controls
          · Resize with the viewport toolbar
        </p>
      </header>
      <Tabs defaultValue="compare">
        <TabsList aria-label="Typography comparison mode">
          <TabsTrigger value="compare">Compare</TabsTrigger>
          <TabsTrigger value="current">Current</TabsTrigger>
          <TabsTrigger value="candidate">Candidate pairing</TabsTrigger>
        </TabsList>
        <TabsContent value="compare">
          <div className="lab-comparison">
            {[false, true].map((proposed) => (
              <article key={String(proposed)}>
                <div className="lab-comparison-label">
                  <BadgeLabel proposed={proposed} />
                </div>
                <LibraryStudy {...args} proposed={proposed} compact />
              </article>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="current">
          <LibraryStudy {...args} />
        </TabsContent>
        <TabsContent value="candidate">
          <LibraryStudy {...args} proposed />
        </TabsContent>
      </Tabs>
    </div>
  );
}
function BadgeLabel({ proposed }: { proposed: boolean }) {
  return (
    <>
      <strong>
        {proposed ? "02 / Candidate pairing" : "01 / Current typography"}
      </strong>
      <span>
        {proposed ? "Bodoni Moda + Space Grotesk" : "Inter + Inter"} / IBM Plex
        Mono metadata
      </span>
    </>
  );
}
const meta = {
  title: "Typography playground/Paired UI",
  component: Playground,
  tags: ["autodocs"],
  args: { headingSize: 48, weight: 400, tracking: -0.02 },
  argTypes: {
    headingSize: { control: { type: "range", min: 28, max: 64, step: 2 } },
    weight: { options: [400, 500, 600, 700], control: "inline-radio" },
    tracking: { options: [-0.04, -0.02, 0, 0.02], control: "inline-radio" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Controls apply only to specimen editorial headings. Navigation, media titles, body copy, buttons and tabs retain the functional face. Compare identical UI before choosing typography; no font approval is implied.",
      },
    },
  },
} satisfies Meta<typeof Playground>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CurrentVersusProposed: Story = {};
export const MobileComparison: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
export const CollectionPairing: Story = {
  render: (args) => (
    <div className="lab-playground">
      <header className="lab-intro">
        <p className="magi-label">Editorial + functional / collection study</p>
        <h1 className="magi-title">A little more breathing room.</h1>
        <p>
          Compare collection headings, body copy, buttons and technical metadata
          with the same content.
        </p>
      </header>
      <div className="lab-comparison">
        {[false, true].map((proposed) => (
          <article key={String(proposed)}>
            <div className="lab-comparison-label">
              <BadgeLabel proposed={proposed} />
            </div>
            <CollectionStudy {...args} proposed={proposed} />
          </article>
        ))}
      </div>
    </div>
  ),
};
export const ScaleAndRhythm: Story = {
  render: (args) => (
    <div className="lab-playground">
      <header className="lab-intro">
        <p className="magi-label">Size / weight / tracking</p>
        <h1 className="magi-title">Hierarchy in context.</h1>
        <p>
          Fixed 28 / 36 / 48 / 64 px sizes. Controls change weight and tracking;
          the paired library above also changes heading size. Check the smaller
          widths before selecting a direction.
        </p>
      </header>
      <div className="lab-comparison">
        {[false, true].map((proposed) => (
          <article
            className="lab-scale"
            key={String(proposed)}
            style={typeStyle({ ...args, proposed })}
          >
            <BadgeLabel proposed={proposed} />
            {[28, 36, 48, 64].map((size) => (
              <div key={size}>
                <p className="lab-meta">
                  {size}px / {args.weight} / {args.tracking}em
                </p>
                <h2 className="lab-editorial" style={{ fontSize: size }}>
                  Collected fragments.
                </h2>
                <p className="lab-description">
                  A small collection of things worth coming back to.
                </p>
              </div>
            ))}
            <Button>Explore collection</Button>
          </article>
        ))}
      </div>
    </div>
  ),
};
