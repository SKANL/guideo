import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LOGIN_CONFIG,
  login,
  type PatchrightPage,
  resolveLoginConfig,
} from "../../../src/adapters/target/login.js";

const LOGIN_URL = "https://example.test/login";
const HOME_URL = "https://example.test/home";

function successfulLoginPage(): { page: PatchrightPage; fills: Array<[string, string]> } {
  let currentUrl = "";
  const fills: Array<[string, string]> = [];

  return {
    fills,
    page: {
      goto: async (url) => {
        currentUrl = url;
      },
      waitForSelector: async () => {},
      fill: async (selector, value) => {
        fills.push([selector, value]);
      },
      click: async () => {
        currentUrl = HOME_URL;
      },
      goBack: async () => {},
      url: () => currentUrl,
      title: async () => "Home",
      $$: async () => [],
      close: async () => {},
    },
  };
}

describe("shared login selector defaults", () => {
  const originalUsernameSelector = process.env.GUIDEO_LOGIN_USERNAME_SELECTOR;

  afterEach(() => {
    if (originalUsernameSelector === undefined) delete process.env.GUIDEO_LOGIN_USERNAME_SELECTOR;
    else process.env.GUIDEO_LOGIN_USERNAME_SELECTOR = originalUsernameSelector;
  });

  it("includes SauceDemo's username input as a deterministic default candidate", async () => {
    const { page, fills } = successfulLoginPage();

    await login(
      page,
      { url: LOGIN_URL, username: "example-user", password: "example-password" },
      DEFAULT_LOGIN_CONFIG,
    );

    expect(fills[0]).toEqual([expect.stringContaining("input#user-name"), "example-user"]);
  });

  it("includes SauceDemo's submit input as a deterministic default candidate", () => {
    expect(DEFAULT_LOGIN_CONFIG.submitSelector).toEqual(expect.stringContaining("input#login-button"));
  });

  it("keeps the environment username-selector override authoritative", () => {
    process.env.GUIDEO_LOGIN_USERNAME_SELECTOR = "[data-test='account-name']";

    expect(resolveLoginConfig(DEFAULT_LOGIN_CONFIG).usernameSelector).toBe(
      "[data-test='account-name']",
    );
  });
});
