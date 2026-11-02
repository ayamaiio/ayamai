import type { Meta, StoryObj } from "@storybook/react-vite";
import { Slider } from "@workspace/ayamai-design-system/components/ui/slider";
const meta = {
  title: "Components/Slider",
  component: Slider,
  tags: ["autodocs"],
} satisfies Meta<typeof Slider>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  args: {
    defaultValue: [40],
    max: 100,
    "aria-label": "Playback position",
    className: "max-w-sm",
  },
};
