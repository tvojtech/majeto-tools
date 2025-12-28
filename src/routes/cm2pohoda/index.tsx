import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/cm2pohoda/')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>cm2pohoda</div>
}
