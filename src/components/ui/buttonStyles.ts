/**
 * Button styling, shared by the Button component and by elements that must
 * look like a Button but aren't one (e.g. an <a> that opens in a new tab).
 * Kept out of the 'use client' Button module so server components can use it.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const baseStyles = `
  inline-flex items-center justify-center gap-2
  font-display font-semibold uppercase tracking-wider
  rounded-lg transition-all duration-300
  focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-avalon-midnight
  disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
`;

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-avalon-gold text-avalon-midnight
    hover:bg-yellow-500 hover:scale-105 hover:shadow-xl
    focus:ring-avalon-gold
    shadow-lg
  `,
  secondary: `
    border-2 border-avalon-silver text-avalon-silver
    hover:bg-avalon-silver hover:text-avalon-midnight
    focus:ring-avalon-silver
  `,
  danger: `
    bg-avalon-crimson text-white
    hover:bg-red-700 hover:scale-105
    focus:ring-avalon-crimson
  `,
  ghost: `
    text-avalon-silver
    hover:bg-avalon-silver/10
    focus:ring-avalon-silver/50
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-xs',
  md: 'px-6 py-3 text-sm',
  lg: 'px-8 py-4 text-base',
};

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return `
    ${baseStyles}
    ${variantStyles[variant]}
    ${sizeStyles[size]}
    ${fullWidth ? 'w-full' : ''}
    ${className}
  `.trim();
}
