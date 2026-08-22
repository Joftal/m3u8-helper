interface ProgressProps {
  value: number
  max?: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  animated?: boolean
}

export default function Progress({
  value,
  max = 100,
  size = 'md',
  showLabel = true,
  animated = true
}: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100))

  const heights = { sm: 'h-1.5', md: 'h-2', lg: 'h-3' }

  return (
    <div className="w-full">
      <div className={`relative ${heights[size]} bg-gray-100 rounded-full overflow-hidden`}>
        <div
          className="absolute inset-y-0 left-0 progress-bar rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        >
          {animated && percentage > 0 && percentage < 100 && (
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="absolute inset-0 animate-shimmer"
                style={{
                  backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)',
                  backgroundSize: '200% 100%'
                }}
              />
            </div>
          )}
        </div>
      </div>
      {showLabel && (
        <p className="text-xs text-gray-400 mt-1">{percentage.toFixed(1)}%</p>
      )}
    </div>
  )
}
