import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@workspace/ayamai-design-system/components/ui/button";
const meta = {
  title: "Components/Button",
  component: Button,
  tags: ["autodocs"],
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { args: { children: "Explore library" } };
export const Variants: Story = {
  render: () => (
    <div className="magi-row">
      {(
        [
          "default",
          "secondary",
          "outline",
          "ghost",
          "link",
          "destructive",
        ] as const
      ).map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
      <Button disabled>Disabled</Button>
    </div>
  ),
};
