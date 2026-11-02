import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "@workspace/ayamai-design-system/components/ui/skeleton";
const meta = {
  title: "Components/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { className: "h-32 w-64 rounded-lg" } };
