import type { ReactNode } from 'react'

// ==================== Spinner ====================

interface SpinnerProps {
  size?: 'sm' | 'md'
}

export function Spinner({ size = 'md' }: SpinnerProps) {
  const dim = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6'
  return (
    <div
      className={`${dim} border-2 border-border border-t-accent rounded-full animate-spin`}
    />
  )
}

// ==================== PageLoading ====================

export function PageLoading() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Spinner />
    </div>
  )
}

// ==================== EmptyState ====================

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && (
        <div className="text-text-muted/40 mb-3">{icon}</div>
      )}
      <p className="text-sm text-text-muted">{title}</p>
      {description && (
        <p className="text-[12px] text-text-muted/60 mt-1">{description}</p>
      )}
    </div>
  )
}
