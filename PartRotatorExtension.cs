using Newtonsoft.Json;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using UnbeGames.API;
using UnbeGames.Controller;
using UnbeGames.Model;
using UnbeGames.Services;
using UnbeGames.Support;
using UnbeGames.UI;
using UnityEngine;

namespace PartRotatorExtension
{
    public struct SinglePartData
    {
        public string configFilePath;
    }
    public struct PartDataList
    {
        public SinglePartData[] partDataList;
    }

    public class PartRotatorExtension : BaseExtension
    {
        private bool partAdded = false;

        public PartRotatorExtension()
        {
        }

        public override async void OnStart()
        {
            Log.Info($"Game systems fully initialized.");

            await LoadAssets();
            


            

            var rocketPartCache = CacheStore.Get<RocketPartCache>();
            var partsCache = typeof(RocketPartCache).GetField("parts", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(rocketPartCache) as Dictionary<int, GameObject>;
            var schemaCache = typeof(RocketPartCache).GetField("schemaItems", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(rocketPartCache) as Dictionary<int, RocketPartSchema>;

            //var MI_Preloadig = typeof(RocketPartCache).GetMethod("Prealoading", BindingFlags.Instance | BindingFlags.NonPublic);
            var MI_TryPostProcss = typeof(RocketPartCache).GetMethod("TryPostprocess", BindingFlags.Instance | BindingFlags.NonPublic);

            
            //var rpcBaker = typeof(RocketPartCache).GetField("baker", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(rocketPartCache) as RocketPartBaker;

            //var MI_CreateAeroCamera = typeof(RocketPartBaker).GetMethod("CreateAeroCamera", BindingFlags.Instance | BindingFlags.NonPublic);
            //var MI_CreateAeroTextures = typeof(RocketPartBaker).GetMethod("CreateAeroTextures", BindingFlags.Instance | BindingFlags.NonPublic);



            var bakerPrefab = CacheStore.prefabs.Get("drag_cube_baker");
            var baker = Helpers.Instantiate< RocketPartBaker>(bakerPrefab);
            typeof(RocketPartCache).GetField("baker", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(rocketPartCache, baker);
            var rpcBaker = typeof(RocketPartCache).GetField("baker", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(rocketPartCache);

            //MI_CreateAeroTextures.Invoke(rpcBaker, new object[] { });
            //MI_CreateAeroCamera.Invoke(rpcBaker, new object[] { });

            //var aeroCamera = typeof(RocketPartBaker).GetField("aeroCamera", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(rpcBaker) as Camera;
            //var aeroTexture = typeof(RocketPartBaker).GetField("aeroTexture", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(rpcBaker) as Texture2D;
            //var resolution = (int)typeof(RocketPartBaker).GetField("resolution", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(rpcBaker);

            //Console.Write("aeroCamera name: " + aeroCamera.name);
            //Console.Write("aeroTexture: " + aeroTexture.isReadable);
            //Console.Write("resolution: " + resolution);

          


            // TODO get path to mod folder
            var currPath = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            var dirs = Directory.GetDirectories(Path.Combine(currPath, "Modded Parts"));

            foreach(var dir in dirs)
            {
                string partListFile = await File.ReadAllTextAsync(Path.Combine(dir, "partList.json"));
                PartDataList partDataList = JsonConvert.DeserializeObject<PartDataList>(partListFile);
                foreach(var partData in partDataList.partDataList)
                {
                    Console.Write("Loading part" + partData.configFilePath);
                    var schema = await AddressableHelper.LoadAssetAsync<TextAsset>(partData.configFilePath);
                    var schemaJson = JsonConvert.DeserializeObject<RocketPartSchema>(schema.text);
                    var dic = new Dictionary<string, GameObject>();
                    var partPrefab = await AddressableHelper.InstantiateAsync(schemaJson.prefabName);
                    partPrefab.name = partPrefab.name.Replace("(Clone)", "");
                    dic.Add(partPrefab.name, partPrefab);
                    var task = (Task)MI_TryPostProcss.Invoke(rocketPartCache, new object[] { schema, dic });
                    await task;
                }
            }

            Object.Destroy(baker);


            //List<TextAsset> schemesToLoad = new List<TextAsset>
            //{
            //    schema
            //};

            ////MI_Preloadig.Invoke(rocketPartCache, new object[] { schemesToLoad });

            //var partSchema = JsonConvert.DeserializeObject<RocketPartSchema>(File.ReadAllText("./partSchema.json"));
            //var partPrefab = await AddressableHelper.InstantiateAsync(partSchema.prefabName);

            //partsCache[partSchema.defindex] = partPrefab;
            //schemaCache[partSchema.defindex] = partSchema;

            //Console.Write("Part " + partSchema.name + " was added");
            //Console.Write();
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

        public override void Update()
        {
            base.Update();
            var asc = Finders.ComponentByTag<AssemblyShopController>(Tag.assemblyShopController, false);
            var app = Finders.ComponentByTag<UnbeGames.Controller.Application>(Tag.application, false);

            if (asc != null && !partAdded)
            {
                //var parts = typeof(AssemblyShopController).GetField("parts", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(asc) as AssemblyParts;
                //var partList = typeof(AssemblyParts).GetField("parts", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(parts) as List<AssemblyPartItem>;
                var MI_AddPart = typeof(AssemblyParts).GetMethod("AddPart", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
                //var partSchema = Clone(partList.ElementAt(0).part);

                //var originalPartDefIndex = partSchema.defindex;

                //partSchema.defindex = 1001;
                //Console.Write("Part name: " + partSchema.name);
                //partSchema.name = "Part Test";
                //MI_AddPart.Invoke(parts, new object[]{ partSchema });


                //var filter = asc.module.filter;
                //asc.module.SetFilter(null);
                //asc.module.SetFilter(filter);

                partAdded = true;
                //Console.Write("Part " + partSchema.name + " was added");
            }

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
                    string catalogFile = await File.ReadAllTextAsync(Path.Combine(dir, "catalog.json"));
                    await File.WriteAllTextAsync(Path.Combine(dir, "catalog.json.original"), catalogFile);
                    string needToReplace = "{UnityEngine.AddressableAssets.Addressables.RuntimePath}";
                    string replacement = Regex.Replace(dir, @"\\", @"\\");
                    catalogFile = catalogFile.Replace(needToReplace, replacement);
                    await File.WriteAllTextAsync(Path.Combine(dir, "catalog.json"), catalogFile);
                    await AddressableHelper.LoadContentCatalog(Path.Combine(dir, "catalog.json"));
                    Console.Write("Loaded content catalog with path " + Path.Combine(dir, "catalog.json"));
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
