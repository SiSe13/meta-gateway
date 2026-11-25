-- 授权分组直接由 team_policies 承载，移除重复的授权模板表。
DROP TABLE IF EXISTS team_model_authorization_groups;
