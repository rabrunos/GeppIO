/** Read the current platform preference at gesture/animation time. */
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)')

export function motionTiming(element: Element, durationProperty: string, easingProperty: string) {
  const style = getComputedStyle(element)
  const token = style.getPropertyValue(durationProperty).trim()
  return {
    duration: parseFloat(token) * (token.endsWith('ms') ? 1 : 1000),
    easing: style.getPropertyValue(easingProperty).trim()
  }
}
