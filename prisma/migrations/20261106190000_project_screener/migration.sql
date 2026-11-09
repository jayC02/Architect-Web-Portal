-- Existing projects retain an unknown building use until explicitly screened.
ALTER TABLE "Project"
  ADD COLUMN "buildingUse" TEXT,
  ADD COLUMN "typeOfWorkKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Project" ADD CONSTRAINT "Project_buildingUse_check"
  CHECK ("buildingUse" IS NULL OR "buildingUse" IN ('residential', 'commercial'));

-- Backfill only established exact work types; arbitrary legacy text stays unset.
UPDATE "Project" SET "typeOfWorkKeys" = ARRAY[
  CASE lower(trim("projectType"))
    WHEN 'domestic_alteration_extension' THEN 'domestic_alteration_extension'
    WHEN 'domestic alteration / extension' THEN 'domestic_alteration_extension'
    WHEN 'new_build' THEN 'new_build'
    WHEN 'new build' THEN 'new_build'
    WHEN 'conversion_change_of_use' THEN 'conversion_change_of_use'
    WHEN 'conversion / change of use' THEN 'conversion_change_of_use'
    WHEN 'demolition' THEN 'demolition'
  END
] WHERE lower(trim("projectType")) IN (
  'domestic_alteration_extension', 'domestic alteration / extension', 'new_build',
  'new build', 'conversion_change_of_use', 'conversion / change of use', 'demolition'
);
