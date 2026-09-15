import { render, screen, fireEvent } from "@testing-library/react";
import axios from "axios";
import AdditionalCorrectiveActions from "./AdditionalCorrectiveActions";

jest.mock("axios");

beforeEach(() => {
  window.history.pushState({}, "", "/run-audit/run-123");
  axios.get.mockImplementation((url) => {
    if (url.includes("action-assignees")) {
      return Promise.resolve({ data: [{ id: "user-1", name: "Chris", email: "chris@example.com" }] });
    }
    return Promise.resolve({ data: { actions: [] } });
  });
  axios.put.mockResolvedValue({ data: { actions: [] } });
});

test("adds another corrective action for the same audit question", async () => {
  render(<AdditionalCorrectiveActions questionId="question-1" />);
  const button = await screen.findByRole("button", { name: /add corrective action/i });
  fireEvent.click(button);
  expect(screen.getByText("Corrective Action 2")).toBeInTheDocument();
  expect(screen.getByPlaceholderText(/what else needs to be done/i)).toBeInTheDocument();
});
