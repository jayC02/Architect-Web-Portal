/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    entitlement?: import('./server/billing/entitlement').Entitlement;
  }
}
