import * as React from "react"

import { cn } from "@/lib/utils"
import { UKDateInput } from './uk-date-input'
import AdditionalCorrectiveActions from "../AdditionalCorrectiveActions"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  const Component = type === 'date' ? UKDateInput : 'input';
  const isPrimaryCorrectiveActionDueDate = props["data-testid"] === "action-due-date";
  const questionId = isPrimaryCorrectiveActionDueDate
    ? String(props.id || "").replace("action-due-", "")
    : null;

  return (
    <>
      <Component
        type={type === 'date' ? undefined : type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props} />
      {isPrimaryCorrectiveActionDueDate && questionId && (
        <AdditionalCorrectiveActions questionId={questionId} />
      )}
    </>
  );
})
Input.displayName = "Input"

export { Input }
