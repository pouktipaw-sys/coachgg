-- Timeline Riot compacte par match (positions, kills, objectifs, balises)
ALTER TABLE "Match" ADD COLUMN "timelineFacts" JSONB;
