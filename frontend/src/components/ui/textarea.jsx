import * as React from "react"

import { cn } from "@/lib/utils"
import AdditionalCorrectiveActions from "../AdditionalCorrectiveActions"

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  const isPrimaryCorrectiveAction = props["data-testid"] === "action-required"
  const questionId = isPrimaryCorrectiveAction
    ? String(props.id || "").replace("action-required-", "")
    : null

  return (
    <>
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props} />
      {isPrimaryCorrectiveAction && questionId && (
        <AdditionalCorrectiveActions questionId={questionId} />
      )}
    </>
  );
})
Textarea.displayName = "Textarea"

export { Textarea }
