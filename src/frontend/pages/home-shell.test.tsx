import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { HomePage } from "@/pages/HomePage";

describe("home and shell", () => {
  it("links the logo home, centers titles, and hides Home on the landing page", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Krayon" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    expect(screen.getByRole("link", { name: /audio analysis/i })).toHaveAttribute("href", "/audio");
    expect(screen.getByRole("link", { name: /reel animations/i })).toHaveAttribute("href", "/reel-animations");
    expect(screen.getByRole("link", { name: /studio/i })).toHaveAttribute("href", "/studio");
  });

  it("shows a back control and a centered title on inner pages", () => {
    render(
      <MemoryRouter>
        <AppShell title="Studio" showBack backTo="/" backLabel="Home">
          <p>inner</p>
        </AppShell>
      </MemoryRouter>,
    );
    const title = screen.getByText("Studio");
    expect(title.className).toMatch(/text-center/);
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Krayon" })).toHaveAttribute("href", "/");
  });
});
