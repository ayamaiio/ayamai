import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@workspace/ayamai-design-system/components/ui/card";
const meta = {
  title: "Components/Card",
  component: Card,
  tags: ["autodocs"],
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  render: () => (
    <Card className="max-w-sm">
      <CardHeader>
        <CardTitle>A quiet collection</CardTitle>
        <CardDescription>Synthetic specimen content</CardDescription>
      </CardHeader>
      <CardContent>Collected moments, ready to rediscover.</CardContent>
    </Card>
  ),
};
