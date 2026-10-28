import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import {
  DEPARTMENT_COLORS,
  DEPARTMENT_ICONS,
  type DepartmentColor,
  type DepartmentIcon,
} from '@vertex-hub/contracts';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  CameraIcon,
  ChartLineIcon,
  ClapperboardIcon,
  CodeIcon,
  FileTextIcon,
  FilmIcon,
  GlobeIcon,
  GraduationCapIcon,
  HandshakeIcon,
  HeadsetIcon,
  LightbulbIcon,
  type LucideIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  MicIcon,
  MonitorSmartphoneIcon,
  NewspaperIcon,
  PaletteIcon,
  PenToolIcon,
  PrinterIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShoppingBagIcon,
  SparklesIcon,
  StethoscopeIcon,
  TargetIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

/** The Lucide component of each curated department icon (F23). */
const departmentIcons = {
  briefcase: BriefcaseIcon,
  building: BuildingIcon,
  settings: SettingsIcon,
  megaphone: MegaphoneIcon,
  'chart-line': ChartLineIcon,
  target: TargetIcon,
  palette: PaletteIcon,
  'pen-tool': PenToolIcon,
  camera: CameraIcon,
  film: FilmIcon,
  clapperboard: ClapperboardIcon,
  mic: MicIcon,
  'file-text': FileTextIcon,
  newspaper: NewspaperIcon,
  code: CodeIcon,
  'monitor-smartphone': MonitorSmartphoneIcon,
  headset: HeadsetIcon,
  'message-circle': MessageCircleIcon,
  stethoscope: StethoscopeIcon,
  users: UsersIcon,
  handshake: HandshakeIcon,
  globe: GlobeIcon,
  lightbulb: LightbulbIcon,
  calendar: CalendarIcon,
  'shopping-bag': ShoppingBagIcon,
  printer: PrinterIcon,
  'shield-check': ShieldCheckIcon,
  wallet: WalletIcon,
  'graduation-cap': GraduationCapIcon,
  sparkles: SparklesIcon,
} as const satisfies Record<DepartmentIcon, LucideIcon>;

/** Background classes of the department colors (tokens `--department-1` … `--department-8`). */
const departmentBackground = {
  c1: 'bg-department-1',
  c2: 'bg-department-2',
  c3: 'bg-department-3',
  c4: 'bg-department-4',
  c5: 'bg-department-5',
  c6: 'bg-department-6',
  c7: 'bg-department-7',
  c8: 'bg-department-8',
} as const satisfies Record<DepartmentColor, string>;

const departmentMarkVariants = cva(
  'inline-flex shrink-0 items-center justify-center text-department-foreground',
  {
    variants: {
      size: {
        /** A dot beside a name, in chips and filters. */
        dot: 'size-2.5 rounded-full [&_svg]:hidden',
        sm: 'size-5 rounded-sm [&_svg]:size-3',
        md: 'size-9 rounded-md [&_svg]:size-4.5',
        lg: 'size-12 rounded-lg [&_svg]:size-6',
      },
      /** An archived department stays visible, faded. */
      muted: { true: 'opacity-40' },
    },
    defaultVariants: { size: 'md' },
  },
);

type DepartmentMarkProps = Omit<ComponentProps<'span'>, 'color' | 'children'> &
  VariantProps<typeof departmentMarkVariants> & {
    color: DepartmentColor;
    icon: DepartmentIcon;
  };

/** A department's icon on its color, or its color as a dot; decorative, its name sits beside it. */
function DepartmentMark({ color, icon, size, muted, className, ...props }: DepartmentMarkProps) {
  const Icon = departmentIcons[icon];
  return (
    <span
      data-slot="department-mark"
      aria-hidden="true"
      className={cn(
        departmentMarkVariants({ size, muted }),
        departmentBackground[color],
        className,
      )}
      {...props}
    >
      <Icon />
    </span>
  );
}

interface PickerProps<Value> {
  value: Value;
  onValueChange: (value: Value) => void;
  /** The accessible name of each option (the app translates it). */
  optionLabel: (value: Value) => string;
  /** The group's accessible name: its label element, or the name itself. */
  'aria-labelledby'?: string;
  'aria-label'?: string;
  id?: string;
  className?: string;
}

const optionClass = cn(
  'flex cursor-pointer items-center justify-center rounded-md border-2 border-transparent outline-none',
  'transition-colors duration-150 ease-out hover:border-border',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  'data-checked:border-foreground',
);

/** The eight department colors as swatches; one is always chosen. */
function DepartmentColorPicker({
  value,
  onValueChange,
  optionLabel,
  className,
  ...props
}: PickerProps<DepartmentColor>) {
  return (
    <RadioGroupPrimitive<DepartmentColor>
      data-slot="department-color-picker"
      value={value}
      onValueChange={(next) => onValueChange(next)}
      className={cn('flex flex-wrap gap-1.5', className)}
      {...props}
    >
      {DEPARTMENT_COLORS.map((color) => (
        <RadioPrimitive.Root<DepartmentColor>
          key={color}
          value={color}
          aria-label={optionLabel(color)}
          className={cn(optionClass, 'size-9 p-0.5')}
        >
          <span className={cn('size-full rounded-sm', departmentBackground[color])} />
        </RadioPrimitive.Root>
      ))}
    </RadioGroupPrimitive>
  );
}

/** The curated department icons as a grid, each on the chosen color. */
function DepartmentIconPicker({
  value,
  onValueChange,
  optionLabel,
  color,
  className,
  ...props
}: PickerProps<DepartmentIcon> & { color: DepartmentColor }) {
  return (
    <RadioGroupPrimitive<DepartmentIcon>
      data-slot="department-icon-picker"
      value={value}
      onValueChange={(next) => onValueChange(next)}
      className={cn('grid grid-cols-6 gap-1.5 sm:grid-cols-10', className)}
      {...props}
    >
      {DEPARTMENT_ICONS.map((icon) => (
        <RadioPrimitive.Root<DepartmentIcon>
          key={icon}
          value={icon}
          aria-label={optionLabel(icon)}
          className={cn(optionClass, 'group p-0.5')}
        >
          <DepartmentMark
            color={color}
            icon={icon}
            className="opacity-60 transition-opacity duration-150 group-hover:opacity-100 group-data-checked:opacity-100"
          />
        </RadioPrimitive.Root>
      ))}
    </RadioGroupPrimitive>
  );
}

export {
  DepartmentColorPicker,
  DepartmentIconPicker,
  DepartmentMark,
  type DepartmentMarkProps,
  departmentBackground,
  departmentIcons,
};
