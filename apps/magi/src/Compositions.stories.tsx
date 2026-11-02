import { LibraryStudy, CollectionStudy } from "./laboratory";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@workspace/ayamai-design-system/components/ui/card";
import { Progress } from "@workspace/ayamai-design-system/components/ui/progress";
import { Badge } from "@workspace/ayamai-design-system/components/ui/badge";
export default {
  title: "Compositions/Library explorations",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Exploratory Ayamai compositions with real shared primitives and synthetic media placeholders. Candidate fonts are not approved. Resize with the viewport toolbar; no production data or providers.",
      },
    },
  },
};
export const MediaCardsAndControls = {
  render: () => <LibraryStudy proposed />,
};
export const MobileLibrary = {
  name: "Library · mobile starting size",
  render: () => <LibraryStudy proposed />,
  parameters: {
    docs: {
      description: {
        story:
          "Select Mobile · 390 from the viewport toolbar. Navigation becomes a compact horizontal rail; cards retain their native aspect ratios.",
      },
    },
  },
  globals: { viewport: { value: "mobile", isRotated: false } },
};
export const EmptyCollection = { render: () => <CollectionStudy proposed /> };
export const CompactNavigation = {
  render: () => <LibraryStudy proposed compact />,
};
export const ImportSummary = {
  render: () => (
    <div className="lab-collection lab-proposed">
      <p className="magi-label">Library / Imports</p>
      <h1 className="lab-editorial">Making room for more.</h1>
      <p className="lab-description">
        Your collection is taking shape. Original media remains private.
      </p>
      <Card className="lab-import">
        <CardHeader>
          <div className="magi-row">
            <Badge>In progress</Badge>
            <span className="lab-meta">Demo batch / 001</span>
          </div>
          <CardTitle>Blue hour studies</CardTitle>
          <CardDescription>
            Gathering small discoveries into one place.
          </CardDescription>
        </CardHeader>
        <CardContent className="magi-stack">
          <Progress value={65} aria-label="Import progress" />
          <p role="status">13 of 20 demo items ready · 65%</p>
          <p className="lab-meta">
            Synthetic progress · no background import is running
          </p>
        </CardContent>
      </Card>
    </div>
  ),
};
