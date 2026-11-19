using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using UnbeGames.API;
using UnbeGames.Model;
using UnbeGames.Mods;
using UnbeGames.Services;
using UnbeGames.Support;
using Unity.Entities.UniversalDelegates;
using Unity.Mathematics;
using UnityEngine;

namespace PartRotatorExtension
{
    public struct Socket
    {
        public uint id;
        public Vector3 position;
        public Vector3 slotDirection;
        public Quaternion slotRotation;
        public string slotShape;
    }
    public struct SinglePartData
    {
        public string configFilePath;
        public string modelFilePath;
        public string physicsColliderFilePath;

        public Socket[] sockets;
        public JObject config;
        public JObject state;
        public JToken variantsConfig;
    }

    public struct PartDataList
    {
        public SinglePartData[] partDataList;
    }


    public static class RPCExt
    {
        public static async Task TryPostprocess(this RocketPartCache rocketPartCache, TextAsset resource, Dictionary<string, GameObject> mapping, RocketPartBaker baker, GameObject model)
        {
            RocketPartSchema schemaItem = null;
            try
            {
                schemaItem = JsonConvert.DeserializeObject<RocketPartSchema>(resource.text);
                var schemaItems = typeof(SchemaCache<RocketPartSchema>).GetField("schemaItems", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(rocketPartCache) as Dictionary<int, RocketPartSchema>;
                var parts = typeof(RocketPartCache).GetField("parts", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(rocketPartCache) as Dictionary<int, GameObject>;
                var postprocessData = typeof(RocketPartCache).GetField("postprocessData", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(rocketPartCache) as Dictionary<int, PostprocessPartData>;

                schemaItems.Add(schemaItem.defindex, schemaItem);
                string fileNameWithoutExtension = Path.GetFileNameWithoutExtension(schemaItem.prefabName);

                parts.Add(schemaItem.defindex, mapping[fileNameWithoutExtension]);

                if (postprocessData.ContainsKey(schemaItem.defindex))
                {
                    schemaItem.Merge(postprocessData[schemaItem.defindex]);
                    return;
                }

                GameObject gameObject = parts[schemaItem.defindex];
                PostprocessPartData data = new PostprocessPartData
                {
                    slotPositions = new List<AttachmentData>(),
                    cableAttachments = new List<CableAttachmentData>()
                };

                GameObject prefabInstance = UnityEngine.Object.Instantiate(gameObject);
                prefabInstance.name = gameObject.name;

                MethodInfo MI_GetModelName = typeof(RocketPartSchema).GetMethod("GetModelName", BindingFlags.Instance | BindingFlags.NonPublic);

                string modelName = MI_GetModelName.Invoke(schemaItem, new object[] { }) as string;

                GameObject obj = model;
                obj.name = "model";
                obj.transform.SetAsFirstSibling();
                RocketPartBaker.BakePartVolume(obj, modelName, ref data.volumeData);
                RocketPartBaker.ProcessConnections(prefabInstance, ref data);
                RocketPartBaker.ProcessCableAttachments(prefabInstance, ref data);
                RocketPartBaker.ProcessAssemblyCollider(prefabInstance, ref data.assemblyCollider);
                RocketPartBaker.ProcessCenterOfMass(prefabInstance, ref data.centerOfMass, schemaItem.centerOfMassAdjustment);
                baker.Bake(prefabInstance, ref data.dragData, AABBExtensions.ToBounds(data.volumeData.bounds), data.centerOfMass);
                if (schemaItem.config != null && schemaItem.HasPhysicsStateConfigs())
                {
                    string[] stateNames = schemaItem.GetStateNames();
                    baker.ProcessStates(prefabInstance, ref data, stateNames);
                }

                if (schemaItem.config != null && schemaItem.HasPartStateConfig())
                {
                    baker.ProcessStateTransitions(prefabInstance, ref data, schemaItem.GetPartStateConfig());
                }

                postprocessData.Add(schemaItem.defindex, data);
                schemaItem.Merge(data);
                prefabInstance.SetActive(false);
                UnityEngine.Object.Destroy(prefabInstance);
                RocketPartCache.OnPartProcessed?.Invoke(schemaItem.prefabName);
            }
            catch (Exception e)
            {
                Log.Exception("Error on postprocessing: " + schemaItem?.prefabName, e);
            }
        }
    }

    public class PartRotatorExtension : BaseExtension
    {
        private bool partAdded = false;

        public PartRotatorExtension()
        {


        }

        public override void OnStart()
        {
            Log.Info($"Game systems fully initialized.");

            try
            {
                PartLoader.PartLoader.LoadAll();
                // The reentry material is preloaded in the background; if it is already there,
                // the shells can use it right away.
                PartLoader.PartLoader.ApplyReentryMaterial();
                // The parts folder is watched: a part that is written again is built
                // again, without a restart of the game.
                PartLoader.PartReloader.Watch(System.IO.Path.GetDirectoryName(
                    System.Reflection.Assembly.GetExecutingAssembly().Location));
            }
            catch (Exception e)
            {
                Log.Exception("[PartAdder] Fatal error while loading custom parts", e);
            }
        }

        public override void OnEnable()
        {
            Log.Info($"Extention was enabled");
        }

        public override void OnDisable()
        {
            Log.Info($"Extention was disabled");
        }

        public override void OnGameLoad()
        {
            Log.Info($"Game was loaded");
        }

        public override void Simulate(double time, double dt)
        {
            base.Simulate(time, dt);
        }

        public override void Update()
        {
            // The shells wait for the reentry material of the game, which arrives with the
            // asynchronous preload of the prefab cache.
            PartLoader.PartLoader.ApplyReentryMaterial();

            // The parts folder is watched: a part that is written while the game runs is
            // built again, so a change can be seen without a restart.
            PartLoader.PartReloader.Tick();

            //base.Update();
            //var asc = Finders.ComponentByTag<AssemblyShopController>(Tag.assemblyShopController, false);
            //var app = Finders.ComponentByTag<UnbeGames.Controller.Application>(Tag.application, false);

            //if (asc != null && !partAdded)
            //{
            //    //var parts = typeof(AssemblyShopController).GetField("parts", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(asc) as AssemblyParts;
            //    //var partList = typeof(AssemblyParts).GetField("parts", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(parts) as List<AssemblyPartItem>;
            //    var MI_AddPart = typeof(AssemblyParts).GetMethod("AddPart", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            //    //var partSchema = Clone(partList.ElementAt(0).part);
            //    var parts = asc.module.selectedRocket.parts;
            //    //var originalPartDefIndex = partSchema.defindex;

            //    //partSchema.defindex = 1001;
            //    //Console.Write("Part name: " + partSchema.name);
            //    //partSchema.name = "Part Test";
            //    //MI_AddPart.Invoke(parts, new object[]{ partSchema });


            //    //var filter = asc.module.filter;
            //    //asc.module.SetFilter(null);
            //    //asc.module.SetFilter(filter);
            //    partAdded = true;
            //    //Console.Write("Part " + partSchema.name + " was added");
            //}

        }

        public override void OnGameShutdown()
        {
            Log.Info($"Game was unloaded");
        }

        public async Task LoadAssets()
        {
            // TODO get path to mod folder
            var currPath = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            var dirs = Directory.GetDirectories(Path.Combine(currPath, "Modded Parts"));
            foreach (var dir in dirs)
            {
                try
                {
                    string catalogFile = await File.ReadAllTextAsync(Path.Combine(dir, "catalog.json.original"));
                    await File.WriteAllTextAsync(Path.Combine(dir, "catalog.json.original"), catalogFile);
                    string needToReplace = "{UnityEngine.AddressableAssets.Addressables.RuntimePath}";
                    string replacement = Regex.Replace(dir, @"\\", @"\\");
                    catalogFile = catalogFile.Replace(needToReplace, replacement);
                    await File.WriteAllTextAsync(Path.Combine(dir, "catalog.json"), catalogFile);
                    await AddressableHelper.LoadContentCatalog(Path.Combine(dir, "catalog.json"));
                    UnbeGames.Services.Console.Write("Loaded content catalog with path " + Path.Combine(dir, "catalog.json"));
                }
                catch (System.Exception ex)
                {
                    GameDebug.LogException("Can't load catalog", ex);
                }
            }

        }

        public static T Clone<T>(T source)
        {
            var serialized = JsonConvert.SerializeObject(source);
            return JsonConvert.DeserializeObject<T>(serialized);
        }


        
    }
}
