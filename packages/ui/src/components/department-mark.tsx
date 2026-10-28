import type { DepartmentColor, DepartmentIcon } from '@vertex-hub/contracts';
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

export { DepartmentMark, type DepartmentMarkProps, departmentBackground, departmentIcons };
